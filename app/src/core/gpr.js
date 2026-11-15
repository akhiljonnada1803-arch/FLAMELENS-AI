// src/core/gpr.js
// Matérn-5/2 ARD Gaussian process with FIXED hyper-parameters exported by
// scripts/build_gpr_artifacts.py. Everything the Design Optimizer draws
// (slices, uncertainty map, what-if updates, grid acquisition) is evaluated here,
// so nothing is interpolated between pre-baked candidates.

const S5 = Math.sqrt(5);

// Plot / grid axes. lo/hi MUST match LO/HI in the Python script.
export const AXES = {
  P:  { i: 0, key: "pressure_atm",        lo: 0.3,  hi: 3.0,  label: "Chamber Pressure P (atm)",         fmt: (v) => `${v.toFixed(1)} atm` },
  O2: { i: 1, key: "o2_mole_fraction",    lo: 0.15, hi: 0.45, label: "Oxidizer Mole Fraction X_O₂",      fmt: (v) => `${Math.round(v * 100)}%` },
  D0: { i: 2, key: "droplet_diameter_mm", lo: 0.5,  hi: 5.0,  label: "Initial Droplet Diameter d₀ (mm)", fmt: (v) => `${v.toFixed(1)} mm` },
};

function cholesky(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) throw new Error("GPR: kernel matrix is not positive definite");
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}
function forward(L, b) {            // solve L x = b
  const n = L.length, x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}
function backward(L, b) {           // solve Lᵀ x = b
  const n = L.length, x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

export class GPR {
  /** @param model one entry of gpr_models.json -> models[fuel]; @param nBase number of real flight points */
  constructor(model, nBase = model.X.length) {
    this.m = model;
    this.hp = model.hp;
    this.nBase = nBase;                 // points at index >= nBase are hypothetical what-if observations
    this.lo = model.x_lo;
    this.hi = model.x_hi;
    this.Xn = model.X.map((x) => this._norm(x));
    const n = this.Xn.length, { noise, ym, ys } = this.hp;
    const K = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        const v = this._k(this.Xn[i], this.Xn[j]) + (i === j ? noise + 1e-9 : 0);
        K[i][j] = v; K[j][i] = v;
      }
    }
    this.L = cholesky(K);
    this.alpha = backward(this.L, forward(this.L, model.y.map((v) => (v - ym) / ys)));
    this._nn = null;
  }

  _norm(x) { return x.map((v, i) => (v - this.lo[i]) / (this.hi[i] - this.lo[i])); }
  _dist(a, b) {                          // length-scale-scaled distance
    let s = 0;
    for (let i = 0; i < 3; i++) { const d = (a[i] - b[i]) / this.hp.ls[i]; s += d * d; }
    return Math.sqrt(s);
  }
  _k(a, b) {
    const d = this._dist(a, b);
    return this.hp["amp"] * (1 + S5 * d + (5 / 3) * d * d) * Math.exp(-S5 * d);
  }

  /** Posterior at x = [pressure_atm, o2_fraction, d0_mm]. sigma* are in mm²/s. */
  predict(x) {
    const xn = this._norm(x), n = this.Xn.length;
    const { amp, noise, ym, ys } = this.hp;
    const ks = new Float64Array(n);
    let mz = 0;
    for (let i = 0; i < n; i++) { ks[i] = this._k(xn, this.Xn[i]); mz += ks[i] * this.alpha[i]; }
    const v = forward(this.L, ks);
    let q = 0;
    for (let i = 0; i < n; i++) q += v[i] * v[i];
    const vf = Math.max(amp - q, 0);                       // epistemic variance, standardised units
    const sigmaF = Math.sqrt(vf) * ys, sigmaN = Math.sqrt(noise) * ys;
    return {
      mean: mz * ys + ym,
      sigmaF,                                              // epistemic (latent function) std
      sigmaN,                                              // aleatoric (measurement) std
      sigmaTotal: Math.hypot(sigmaF, sigmaN),              // predictive std for a new measurement
      eigBits: 0.5 * Math.log2(1 + vf / noise),            // expected information gain of one noisy observation
    };
  }

  /** Same GP conditioned on one extra (hypothetical) observation. Variance does not depend on y. */
  withObservation(x, y) {
    return new GPR({ ...this.m, X: [...this.m.X, x], y: [...this.m.y, y] }, this.nBase);
  }
  get hypotheticalCount() { return this.Xn.length - this.nBase; }

  /** Axis-aligned bounding box of the REAL flight records. */
  envelope() {
    const e = { P: [Infinity, -Infinity], O2: [Infinity, -Infinity], D0: [Infinity, -Infinity] };
    const keys = ["P", "O2", "D0"];
    for (let i = 0; i < this.nBase; i++) {
      keys.forEach((k, a) => {
        const v = this.m.X[i][a];
        if (v < e[k][0]) e[k][0] = v;
        if (v > e[k][1]) e[k][1] = v;
      });
    }
    return e;
  }

  _nnMedian() {
    if (this._nn !== null) return this._nn;
    const d = [];
    for (let i = 0; i < this.nBase; i++) {
      let best = Infinity;
      for (let j = 0; j < this.nBase; j++) if (j !== i) best = Math.min(best, this._dist(this.Xn[i], this.Xn[j]));
      if (isFinite(best)) d.push(best);
    }
    d.sort((a, b) => a - b);
    this._nn = d.length ? d[d.length >> 1] : 1;
    return this._nn;
  }

  /** Distance to the nearest REAL flight run, in length-scales and relative to typical run spacing. */
  novelty(x) {
    const xn = this._norm(x), near = [];
    for (let i = 0; i < this.nBase; i++) near.push({ i, d: this._dist(xn, this.Xn[i]) });
    near.sort((a, b) => a.d - b.d);
    const med = this._nnMedian() || 1;
    return {
      dist: near[0].d,
      ratio: near[0].d / med,
      nearest: near.slice(0, 3).map(({ i, d }) => ({ id: this.m.ids?.[i], x: this.m.X[i], k: this.m.y[i], dist: d })),
    };
  }
}

const round = (v, d) => { const p = 10 ** d; return Math.round(v * p) / p; };
const range = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(4)); return o; };

/**
 * Sequential batch acquisition on a grid under the user's constraints.
 * Each pick is conditioned on the earlier picks (posterior variance does not depend on the unseen y,
 * so this is exact for variance-based objectives) -> batches are naturally diverse.
 * Returns candidate objects in the same shape the optimizer already consumes.
 */
export function gridAcquire(gp, limits, { k = 6, objective = "MAX_INFORMATION_GAIN", evalFeas, costOf = () => 1, fuel = "n-heptane" }) {
  const ps = range(0.3, Math.min(limits.maxP, 3.0), 0.15);
  const o2s = range(0.15, Math.min(limits.maxO2, 0.45), 0.03);
  const ds = range(0.5, Math.min(limits.maxD0, 5.0), 0.25);
  const nodes = [];
  for (const p of ps) for (const o of o2s) for (const d of ds) {
    const f = evalFeas(p, o, d);
    if (f.isFeasible) nodes.push({ x: [p, o, d], f, used: false });
  }
  const picks = [];
  let model = gp;
  for (let r = 0; r < k; r++) {
    let best = null, bestScore = -Infinity;
    for (const nd of nodes) {
      if (nd.used) continue;
      const pr = model.predict(nd.x);
      const score = objective === "MAX_PREDICTIVE_VARIANCE" ? pr.sigmaF ** 2
        : objective === "EIG_PER_COST" ? pr.eigBits / (costOf(nd.f.feasibilityStatus) || 1)
        : pr.eigBits;
      if (score > bestScore) { bestScore = score; best = { nd, pr }; }
    }
    if (!best) break;
    best.nd.used = true;
    const base = gp.predict(best.nd.x);
    picks.push({
      candidate_id: `GRID-${String(r + 1).padStart(2, "0")}`,
      batch_rank: r + 1,
      source: "live-gp-grid",
      fuel,
      model_status: "CALIBRATED",
      pressure_atm: best.nd.x[0],
      o2_mole_fraction: best.nd.x[1],
      droplet_diameter_mm: best.nd.x[2],
      predicted_burn_rate_k: round(base.mean, 4),
      latent_uncertainty_sigma_f: round(base.sigmaF, 4),
      latent_variance_sigma_f_sq: round(base.sigmaF ** 2, 6),
      observation_noise_sigma_n: round(base.sigmaN, 4),
      prediction_uncertainty_std: round(base.sigmaTotal, 4),
      expected_information_gain_bits: round(best.pr.eigBits, 4),   // marginal EIG given picks 1..r-1
      scientific_rationale: `Batch pick #${r + 1} on the live GP grid: highest ${objective === "MAX_PREDICTIVE_VARIANCE" ? "epistemic variance" : objective === "EIG_PER_COST" ? "EIG per assumed cost" : "expected information gain"} after conditioning on picks 1–${r}.`,
    });
    model = model.withObservation(best.nd.x, best.pr.mean);        // "believer" update: only the variance matters
  }
  return picks;
}

