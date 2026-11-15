#!/usr/bin/env python3
"""
build_gpr_artifacts.py
----------------------
Fits one Matern-5/2 ARD Gaussian process per fuel on the flight records in
evidence_ledger.json and exports everything the Design Optimizer needs to compute
mu(x), sigma_f(x), EIG and "what-if" updates *in the browser*:

    <out>/gpr_models.json        hyper-parameters, training data, 5-fold CV metrics
    <out>/benchmark_honest.json  paired sequential active-learning benchmark (mean +/- SD, 95% CI)

Usage:
    pip install numpy scipy scikit-learn
    python scripts/build_gpr_artifacts.py public/data/evidence_ledger.json public/data

Notes
 * Inputs are (pressure_atm, x_o2, d0_mm); target is burning_rate_mm2_s.
 * Normalisation bounds LO/HI MUST match AXES in src/core/gpr.js.
 * If your existing pipeline already fits these GPs, swap fit_hyper() for your
   exported hyper-parameters so the UI and the paper use the same model.
 * Benchmark protocol (no test leakage): per repetition, random 30-point held-out test
   set, 15-point initial train set, hyper-parameters refit on the initial set only and
   then frozen, 10 sequential acquisitions from the remaining pool.
 * Under a homoscedastic-noise GP, "max EIG" and "max predictive variance" pick the same
   point (EIG = 0.5*log2(1 + var_f/var_n) is monotone in var_f), so they are not benchmarked
   as separate strategies. SPACE_FILLING (farthest-point) is the second baseline instead.
"""
import json
import math
import platform
import sys
import warnings
from pathlib import Path

import numpy as np
import sklearn
from scipy import stats
from scipy.linalg import cho_factor, cho_solve, solve_triangular
from sklearn.exceptions import ConvergenceWarning
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel as C, Matern, WhiteKernel
from sklearn.model_selection import KFold

warnings.filterwarnings("ignore", category=ConvergenceWarning)

LO = np.array([0.3, 0.15, 0.5])   # pressure_atm, x_o2, d0_mm  (keep in sync with AXES in gpr.js)
HI = np.array([3.0, 0.45, 5.0])
FUELS = {"n-heptane": "heptane", "methanol": "methanol"}   # ui key -> substring of material_or_fuel
SEED = 7
N_REPS, N_INIT, N_STEPS, N_TEST = 10, 15, 10, 30
STRATEGIES = ["RANDOM", "BAYESIAN_EIG", "SPACE_FILLING"]


# ----------------------------------------------------------------------------- data
def load_fuel(ledger, key):
    X, y, ids, gravity = [], [], [], set()
    for r in ledger:
        if key not in (r.get("material_or_fuel") or "").lower():
            continue
        n = r.get("normalized_measurements") or {}
        try:
            p, o2, d0, k = (float(n[f]) for f in ("pressure_atm", "x_o2", "d0_mm", "burning_rate_mm2_s"))
        except (KeyError, TypeError, ValueError):
            continue
        if not (np.isfinite([p, o2, d0, k]).all() and p > 0 and 0 < o2 <= 1 and d0 > 0):
            continue
        X.append([p, o2, d0]); y.append(k); ids.append(r.get("evidence_id")); gravity.add(str(r.get("gravity")))
    return np.array(X, float), np.array(y, float), ids, sorted(gravity)


def norm(X):
    return (np.asarray(X) - LO) / (HI - LO)


# ----------------------------------------------------------------------------- GP
def fit_hyper(Xn, y, restarts=8, seed=SEED):
    ym, ys = float(y.mean()), float(y.std()) or 1.0
    kernel = (C(1.0, (1e-2, 1e2)) * Matern([0.5] * 3, (0.05, 20.0), nu=2.5)
              + WhiteKernel(0.1, (1e-4, 1.0)))
    gp = GaussianProcessRegressor(kernel, n_restarts_optimizer=restarts, random_state=seed)
    gp.fit(Xn, (y - ym) / ys)
    k = gp.kernel_
    return {
        "amp": float(k.k1.k1.constant_value),
        "ls": [float(v) for v in k.k1.k2.length_scale],
        "noise": float(k.k2.noise_level),     # in standardised-y units
        "ym": ym, "ys": ys,
    }


def kern(A, B, hp):
    d = np.sqrt((((A[:, None, :] - B[None, :, :]) / np.asarray(hp["ls"])) ** 2).sum(-1))
    s5 = math.sqrt(5.0)
    return hp["amp"] * (1 + s5 * d + (5.0 / 3.0) * d ** 2) * np.exp(-s5 * d)


class FixedGP:
    """Exact GP posterior with frozen hyper-parameters (mirrors src/core/gpr.js)."""

    def __init__(self, hp, Xn, y):
        self.hp, self.Xn = hp, Xn
        K = kern(Xn, Xn, hp) + (hp["noise"] + 1e-9) * np.eye(len(Xn))
        self.c = cho_factor(K, lower=True)
        self.alpha = cho_solve(self.c, (y - hp["ym"]) / hp["ys"])

    def predict(self, Xs):
        Ks = kern(Xs, self.Xn, self.hp)
        mu = Ks @ self.alpha
        v = solve_triangular(self.c[0], Ks.T, lower=True)
        var = np.maximum(self.hp["amp"] - (v ** 2).sum(0), 0.0)     # standardised units
        ys = self.hp["ys"]
        return mu * ys + self.hp["ym"], np.sqrt(var) * ys, var


def eig_bits(var, noise):
    return 0.5 * np.log2(1.0 + var / noise)


# ----------------------------------------------------------------------------- CV
def cross_validate(Xn, y):
    kf = KFold(5, shuffle=True, random_state=SEED)
    r2s, rmses, hits, total = [], [], 0, 0
    for tr, te in kf.split(Xn):
        hp = fit_hyper(Xn[tr], y[tr], restarts=3)
        mu, sf, _ = FixedGP(hp, Xn[tr], y[tr]).predict(Xn[te])
        st = np.hypot(sf, math.sqrt(hp["noise"]) * hp["ys"])
        err = y[te] - mu
        ss_tot = ((y[te] - y[te].mean()) ** 2).sum()
        r2s.append(1 - (err ** 2).sum() / ss_tot if ss_tot > 0 else float("nan"))
        rmses.append(math.sqrt((err ** 2).mean()))
        hits += int((np.abs(err) <= 1.96 * st).sum()); total += len(te)
    return {
        "folds": 5,
        "r2": {"mean": float(np.nanmean(r2s)), "std": float(np.nanstd(r2s))},
        "rmse_mm2_s": {"mean": float(np.mean(rmses)), "std": float(np.std(rmses))},
        "predictive_interval_coverage_95": hits / total,
    }


# ----------------------------------------------------------------------------- benchmark
def run_benchmark(Xn, y):
    need = N_TEST + N_INIT + N_STEPS + 1
    if len(Xn) < need:
        return {"error": f"need >= {need} points, have {len(Xn)}"}
    curves = {s: [] for s in STRATEGIES}
    for rep in range(N_REPS):
        perm = np.random.default_rng(SEED + rep).permutation(len(Xn))
        te, init, pool0 = perm[:N_TEST], perm[N_TEST:N_TEST + N_INIT], perm[N_TEST + N_INIT:]
        hp = fit_hyper(Xn[init], y[init], restarts=3)            # refit on initial set only
        for s in STRATEGIES:
            srng = np.random.default_rng(1000 + rep)
            tr, pool, curve = list(init), list(pool0), []
            for step in range(N_STEPS + 1):
                gp = FixedGP(hp, Xn[tr], y[tr])
                mu, _, _ = gp.predict(Xn[te])
                curve.append(float(np.sqrt(((y[te] - mu) ** 2).mean())))
                if step == N_STEPS:
                    break
                if s == "RANDOM":
                    j = int(srng.integers(len(pool)))
                elif s == "BAYESIAN_EIG":
                    _, _, var = gp.predict(Xn[pool])
                    j = int(np.argmax(eig_bits(var, hp["noise"])))
                else:  # SPACE_FILLING: farthest point (length-scale-scaled) from current training set
                    d = np.linalg.norm((Xn[pool][:, None, :] - Xn[tr][None, :, :]) / np.asarray(hp["ls"]), axis=-1).min(1)
                    j = int(np.argmax(d))
                tr.append(pool.pop(j))
            curves[s].append(curve)

    arr = {s: np.array(c) for s, c in curves.items()}
    tcrit = float(stats.t.ppf(0.975, N_REPS - 1))
    out = {}
    for s in STRATEGIES:
        a = arr[s]
        entry = {
            "initial_rmse_mean": float(a[:, 0].mean()),
            "final_rmse_mean": float(a[:, -1].mean()),
            "final_rmse_std": float(a[:, -1].std(ddof=1)),
            "pct_rmse_reduction_mean": float(((a[:, 0] - a[:, -1]) / a[:, 0]).mean() * 100),
            "ipe_mean": float(a.sum(1).mean()),
            "trajectory_mean": a.mean(0).round(6).tolist(),
            "trajectory_std": a.std(0, ddof=1).round(6).tolist(),
            "final_rmse_per_rep": a[:, -1].round(6).tolist(),
            "paired_vs_random": None,
        }
        if s != "RANDOM":
            diff = a[:, -1] - arr["RANDOM"][:, -1]
            se = float(diff.std(ddof=1) / math.sqrt(N_REPS))
            m = float(diff.mean())
            entry["paired_vs_random"] = {
                "mean_diff": m, "std_diff": float(diff.std(ddof=1)), "se": se,
                "ci95": [m - tcrit * se, m + tcrit * se],
                "wins": int((diff < 0).sum()), "n": N_REPS,
            }
        out[s] = entry
    return {
        "protocol": {"n_reps": N_REPS, "n_init": N_INIT, "n_steps": N_STEPS, "n_test": N_TEST,
                     "hyperparameters": "refit on initial set only, then frozen",
                     "selection_pool": "remaining observed flight records (cannot acquire unseen conditions)"},
        "strategies": out,
    }


# ----------------------------------------------------------------------------- main
def main():
    ledger_path = Path(sys.argv[1] if len(sys.argv) > 1 else "public/data/evidence_ledger.json")
    out_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "public/data")
    ledger = json.loads(ledger_path.read_text())
    meta = {"python": platform.python_version(), "scikit_learn": sklearn.__version__, "seed": SEED,
            "source_ledger": ledger_path.name}

    models, bench = {}, {}
    for ui_key, needle in FUELS.items():
        X, y, ids, grav = load_fuel(ledger, needle)
        print(f"[{ui_key}] usable flight records: {len(X)}  (gravity values seen: {grav})")
        if len(X) < 12:
            print("   skipped: too few records"); continue
        Xn = norm(X)
        hp = fit_hyper(Xn, y)
        cv = cross_validate(Xn, y)
        print(f"   hp: amp={hp['amp']:.3f} ls={np.round(hp['ls'], 3).tolist()} noise={hp['noise']:.4f}")
        print(f"   5-fold CV: R2={cv['r2']['mean']:.3f}  RMSE={cv['rmse_mm2_s']['mean']:.4f}  cov95={cv['predictive_interval_coverage_95']:.2f}")
        models[ui_key] = {
            "n": int(len(X)), "x_lo": LO.tolist(), "x_hi": HI.tolist(), "hp": hp,
            "X": np.round(X, 6).tolist(), "y": np.round(y, 6).tolist(), "ids": ids,
            "cv": cv, "gravity_values_seen": grav,
            "note": "Hyper-parameters fitted on all N records (type-II ML); CV refits per fold.",
        }
        b = run_benchmark(Xn, y)
        b["n"] = int(len(X))
        bench[ui_key] = b
        if "strategies" in b:
            for s, e in b["strategies"].items():
                pd = e["paired_vs_random"]
                extra = f"  paired vs RANDOM: {pd['mean_diff']:+.4f} CI[{pd['ci95'][0]:+.4f},{pd['ci95'][1]:+.4f}] wins {pd['wins']}/{pd['n']}" if pd else ""
                print(f"   {s:14s} final RMSE {e['final_rmse_mean']:.4f} +/- {e['final_rmse_std']:.4f}{extra}")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "gpr_models.json").write_text(json.dumps({"generated_with": meta, "models": models}))
    (out_dir / "benchmark_honest.json").write_text(json.dumps({"generated_with": meta, "by_fuel": bench}))
    print(f"wrote {out_dir / 'gpr_models.json'} and {out_dir / 'benchmark_honest.json'}")


if __name__ == "__main__":
    main()
