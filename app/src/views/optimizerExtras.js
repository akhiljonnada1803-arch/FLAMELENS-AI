// src/views/optimizerExtras.js
import { esc } from "../core/dom.js";

/* ---------- fetch that actually reports failures ---------- */
export async function loadJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

/* ---------- epistemic vs total uncertainty ---------- */
export function epistemicOf(c) {
  if (c.latent_uncertainty_sigma_f != null) return { sigma: c.latent_uncertainty_sigma_f, kind: "epistemic" };
  if (c.prediction_uncertainty_std != null) return { sigma: c.prediction_uncertainty_std, kind: "total" };
  return null;
}

/* ---------- cross-tab handoff (sessionStorage, so it works with any router) ---------- */
const KEY = "flamelens:handoff";
export function sendHandoff(target, payload) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ target, payload, t: Date.now() })); } catch { /* private mode */ }
}
export function consumeHandoff(target, maxAgeMs = 60000) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const h = JSON.parse(raw);
    if (h.target !== target || Date.now() - h.t > maxAgeMs) return null;
    sessionStorage.removeItem(KEY);
    return h.payload;
  } catch { return null; }
}
/** The 3D Laboratory sliders are narrower than the optimizer's search space — clamp and say so. */
export function clampForLab(p) {
  // Keys must match the candidate object fields produced by normalizedCandidates in optimizerFacility.js
  const R = { pressure_atm: [0.5, 3.0], o2_mole_fraction: [0.10, 0.40], droplet_diameter_mm: [1.0, 5.0] };
  const names = { pressure_atm: "Pressure", o2_mole_fraction: "O₂ fraction", droplet_diameter_mm: "Droplet d₀" };
  const out = { ...p, notes: [] };
  for (const [k, [lo, hi]] of Object.entries(R)) {
    if (p[k] == null) continue;
    const v = Math.min(hi, Math.max(lo, p[k]));
    if (v !== p[k]) out.notes.push(`${names[k]} ${p[k]} is outside the Lab range (${lo}–${hi}); clamped to ${v}.`);
    out[k] = v;
  }
  return out;
}

/* ---------- printable one-page test card ---------- */
export function openTestCard({ fuel, objective, gravity, constraints, batch, gp, modelMeta, bench }) {
  const f3 = (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(3));
  const rows = batch.map((c, i) => {
    const x = [c.pressure_atm, c.o2_mole_fraction, c.droplet_diameter_mm];
    const ok = gp && x.every((v) => v != null);
    const pr = ok ? gp.predict(x) : null, nov = ok ? gp.novelty(x) : null;
    const k = pr ? pr.mean : c.predicted_burn_rate_k;
    const near = nov ? nov.nearest.map((n) => esc(n.id || "run")).join(", ") : "—";
    return `<tr>
      <td>${i + 1}</td><td><b>${esc(c.candidate_id)}</b></td>
      <td>${x[0]?.toFixed(2) ?? "—"}</td><td>${x[1] != null ? (x[1] * 100).toFixed(0) : "—"}</td><td>${x[2]?.toFixed(1) ?? "—"}</td>
      <td>${f3(k)} ± ${pr ? f3(2 * pr.sigmaF) : "—"}</td><td>${pr ? f3(2 * pr.sigmaTotal) : "—"}</td>
      <td>${f3(pr ? pr.eigBits : c.expected_information_gain_bits)}</td>
      <td>${c.burnTimeS != null ? c.burnTimeS.toFixed(1) + " s" : (k > 0 ? (x[2] ** 2 / k).toFixed(1) + " s" : "—")}</td>
      <td>${esc(c.feasibility_status || "—")}<br><small>${esc(c.recommended_facility || "")}</small></td>
      <td>${nov ? nov.ratio.toFixed(1) + "×" : "—"}<br><small>${near}</small></td></tr>`;
  }).join("");

  const cv = modelMeta?.cv;
  const modelLine = modelMeta
    ? `GPR Matérn 5/2 ARD · ${esc(fuel)} · N=${modelMeta.n} flight records · 5-fold CV R² ${f3(cv?.r2?.mean)}, RMSE ${f3(cv?.rmse_mm2_s?.mean)} mm²/s, 95% coverage ${cv ? (cv.predictive_interval_coverage_95 * 100).toFixed(0) + "%" : "—"} · σ_n ${f3(Math.sqrt(modelMeta.hp.noise) * modelMeta.hp.ys)} mm²/s`
    : "No fitted model loaded.";
  const pd = bench?.strategies?.BAYESIAN_EIG?.paired_vs_random;
  const benchLine = pd
    ? `Retrospective active-learning check: EIG − Random final RMSE ${pd.mean_diff.toFixed(4)} mm²/s, 95% CI [${pd.ci95[0].toFixed(4)}, ${pd.ci95[1].toFixed(4)}] over ${pd.n} paired reps (${pd.ci95[0] > 0 || pd.ci95[1] < 0 ? "distinguishable from zero" : "not distinguishable from random"}).`
    : "No benchmark loaded.";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>FlameLens Test Card</title><style>
    body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:28px;max-width:1100px}
    h1{font-size:20px;margin:0 0 2px} .sub{color:#555;margin-bottom:14px}
    table{border-collapse:collapse;width:100%;margin:12px 0;font-size:11.5px} th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}
    th{background:#eef2f7} small{color:#555} .box{border:1px solid #bbb;padding:8px 10px;margin:8px 0;background:#fafafa}
    .warn{border-color:#c77f00;background:#fff7e6} button{padding:6px 12px;margin-bottom:10px} @media print{button{display:none}body{margin:12mm}}
  </style></head><body>
  <button onclick="window.print()">Print / Save as PDF</button>
  <h1>FlameLens AI — Proposed Droplet-Combustion Test Card</h1>
  <div class="sub">${esc(new Date().toISOString())} · Fuel: <b>${esc(fuel)}</b> · Objective: ${esc(objective)} · Gravity: ${gravity} g</div>
  <div class="box"><b>Constraints:</b> P ≤ ${constraints.maxP} atm · O₂ ≤ ${(constraints.maxO2 * 100).toFixed(0)}% · d₀ ≤ ${constraints.maxD0} mm</div>
  <table><thead><tr><th>#</th><th>ID</th><th>P (atm)</th><th>O₂ (%)</th><th>d₀ (mm)</th><th>Pred. K ± 2σ_f (mm²/s)</th><th>±2σ predictive</th><th>EIG (bits)</th><th>Burn time d₀²/K</th><th>Status / facility</th><th>Novelty / nearest flight runs</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="box"><b>Model:</b> ${modelLine}</div>
  <div class="box">${benchLine}</div>
  <div class="box warn"><b>Read before use.</b> Candidates are <i>hypothetical</i>. K values are surrogate predictions, not measurements. σ_f is epistemic (model) uncertainty; "predictive" adds measurement noise σ_n. Novelty is the distance to the nearest real flight run relative to typical run spacing (values above ~2× are an extrapolation heuristic, not a statistical test). Facility notes use the flight-data envelope in the evidence ledger and the NASA CIR / Zero-Gravity Research Facility descriptions; facility-cost weights, if used for ranking, are placeholders. ${gravity > 0 ? "Partial-gravity predictions are extrapolations: the dataset contains no partial-gravity trials." : ""}</div>
  </body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

