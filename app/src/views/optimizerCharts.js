// src/views/optimizerCharts.js
// Canvas renderers for the Design Optimizer. All curves are evaluated live from the fitted GP.
import { AXES } from "../core/gpr.js";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const C = {
  mean: "#38bdf8", epi: "rgba(56,189,248,0.34)", epiEdge: "rgba(56,189,248,0.85)",
  tot: "rgba(168,85,247,0.14)", totEdge: "rgba(168,85,247,0.55)",
  flight: "#0284c7", flightEdge: "#38bdf8", cand: "#ff791f", hypo: "#f59e0b", text: "rgba(148,163,184,0.75)",
};
const SLICE_TOL = [0.3, 0.05, 0.8];            // |Δ| on the two fixed axes for showing flight runs (P, O₂, d₀)

function setup(canvas, wrap, height) {
  const rect = wrap.getBoundingClientRect();
  const w = Math.max(300, rect.width || wrap.clientWidth || 800);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr; canvas.height = height * dpr;
  canvas.style.width = `${w}px`; canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, height);
  return { ctx, w, h: height };
}

const ticks = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (i / n) * (b - a));

function frame(ctx, { w, h, pad, xr, yr, xTicks, yTicks, xFmt, yFmt, xLabel, yLabel, grid = true }) {
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
  const toX = (v) => pad.l + ((v - xr[0]) / (xr[1] - xr[0])) * plotW;
  const toY = (v) => pad.t + (1 - (v - yr[0]) / (yr[1] - yr[0])) * plotH;
  const fromX = (px) => xr[0] + ((px - pad.l) / plotW) * (xr[1] - xr[0]);
  const fromY = (py) => yr[0] + (1 - (py - pad.t) / plotH) * (yr[1] - yr[0]);
  ctx.font = "10px monospace"; ctx.lineWidth = 1;
  yTicks.forEach((v) => {
    const y = toY(v);
    if (grid) { ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); }
    ctx.fillStyle = C.text; ctx.textAlign = "right"; ctx.fillText(yFmt(v), pad.l - 8, y + 3);
  });
  xTicks.forEach((v) => {
    const x = toX(v);
    if (grid) { ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); }
    ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.fillText(xFmt(v), x, h - pad.b + 15);
  });
  ctx.fillStyle = "rgba(148,163,184,0.9)"; ctx.font = "11px monospace"; ctx.textAlign = "center";
  ctx.fillText(xLabel, pad.l + plotW / 2, h - 8);
  ctx.save(); ctx.translate(15, pad.t + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();
  return { toX, toY, fromX, fromY, plotW, plotH, pad };
}

const candVec = (c) => (c && c.pressure_atm != null && c.o2_mole_fraction != null && c.droplet_diameter_mm != null)
  ? [c.pressure_atm, c.o2_mole_fraction, c.droplet_diameter_mm] : null;

/* ============================================================ 1D SLICE ============================================================ */
export function drawSlice({ canvas, wrap, hud, gp, baseGp = null, axis, fixed, candidate }) {
  const { ctx, w, h } = setup(canvas, wrap, 340);
  const A = AXES[axis], N = 100;
  const at = (x) => { const v = [fixed.p, fixed.o2, fixed.d0]; v[A.i] = x; return v; };
  const xs = Array.from({ length: N }, (_, j) => A.lo + (j / (N - 1)) * (A.hi - A.lo));
  const cur = xs.map((x) => ({ x, ...gp.predict(at(x)) }));
  const base = baseGp ? xs.map((x) => ({ x, ...baseGp.predict(at(x)) })) : null;
  const all = base ? cur.concat(base) : cur;
  const yMax = Math.ceil(Math.max(0.5, ...all.map((c) => c.mean + 2 * c.sigmaTotal)) * 10) / 10;
  const yMin = Math.floor(Math.min(0, ...all.map((c) => c.mean - 2 * c.sigmaTotal)) * 10) / 10;

  const f = frame(ctx, {
    w, h, pad: { l: 60, r: 30, t: 30, b: 45 }, xr: [A.lo, A.hi], yr: [yMin, yMax],
    xTicks: ticks(A.lo, A.hi, 6), yTicks: ticks(yMin, yMax, 5), xFmt: A.fmt, yFmt: (v) => v.toFixed(2),
    xLabel: A.label, yLabel: "Burning Rate K (mm²/s)",
  });

  // shade the region with NO flight data on this axis (pure extrapolation)
  const env = gp.envelope()[axis];
  ctx.fillStyle = "rgba(245,158,11,0.07)";
  if (env[0] > A.lo) ctx.fillRect(f.toX(A.lo), f.pad.t, f.toX(env[0]) - f.toX(A.lo), f.plotH);
  if (env[1] < A.hi) ctx.fillRect(f.toX(env[1]), f.pad.t, f.toX(A.hi) - f.toX(env[1]), f.plotH);
  ctx.fillStyle = "#fde68a"; ctx.font = "9.5px monospace"; ctx.textAlign = "left";
  if (env[0] > A.lo + 0.02 * (A.hi - A.lo)) ctx.fillText("no flight data →", f.toX(A.lo) + 6, f.pad.t + 12);
  if (env[1] < A.hi - 0.02 * (A.hi - A.lo)) { ctx.textAlign = "right"; ctx.fillText("← no flight data", f.toX(A.hi) - 6, f.pad.t + 12); }

  const band = (arr, sig, fill, stroke, dash = []) => {
    ctx.beginPath();
    arr.forEach((c, j) => { const X = f.toX(c.x), Y = f.toY(Math.min(yMax, c.mean + 2 * c[sig])); j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    for (let j = arr.length - 1; j >= 0; j--) ctx.lineTo(f.toX(arr[j].x), f.toY(Math.max(yMin, arr[j].mean - 2 * arr[j][sig])));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.setLineDash(dash); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
  };
  band(cur, "sigmaTotal", C.tot, C.totEdge, [2, 3]);                 // predictive (σ_f ⊕ σ_n)
  band(cur, "sigmaF", C.epi, C.epiEdge);                              // epistemic only
  if (base) band(base, "sigmaF", null, "rgba(255,255,255,0.45)", [5, 4]);   // what-if: baseline epistemic outline

  ctx.beginPath();
  cur.forEach((c, j) => { const X = f.toX(c.x), Y = f.toY(c.mean); j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.strokeStyle = C.mean; ctx.lineWidth = 2.5; ctx.stroke();

  // flight runs near this slice (real) + hypothetical what-if observations
  let shown = 0;
  gp.m.X.forEach((x, i) => {
    const near = [0, 1, 2].every((a) => a === A.i || Math.abs(x[a] - [fixed.p, fixed.o2, fixed.d0][a]) <= SLICE_TOL[a]);
    if (!near) return;
    const px = f.toX(x[A.i]), py = f.toY(gp.m.y[i]);
    if (px < f.pad.l || px > w - f.pad.r || py < f.pad.t || py > h - f.pad.b) return;
    const hypo = i >= gp.nBase;
    if (!hypo) shown++;
    ctx.beginPath();
    if (hypo) { ctx.rect(px - 5, py - 5, 10, 10); ctx.strokeStyle = C.hypo; ctx.lineWidth = 2; ctx.stroke(); }
    else { ctx.arc(px, py, 3.8, 0, Math.PI * 2); ctx.fillStyle = C.flight; ctx.fill(); ctx.strokeStyle = C.flightEdge; ctx.lineWidth = 1.1; ctx.stroke(); }
  });
  ctx.fillStyle = C.text; ctx.font = "10px monospace"; ctx.textAlign = "left";
  ctx.fillText(`${shown} flight runs within slice tolerance`, f.pad.l + 6, h - f.pad.b - 6);

  // selected candidate
  const cv = candVec(candidate);
  if (cv) {
    const cx = f.toX(cv[A.i]), cy = f.toY(gp.predict(cv).mean);
    if (cv[A.i] >= A.lo && cv[A.i] <= A.hi) {
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,121,31,0.25)"; ctx.fill();
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = C.cand; ctx.fillRect(-5, -5, 10, 10); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.strokeRect(-5, -5, 10, 10); ctx.restore();
      ctx.fillStyle = "#ff9a4d"; ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
      ctx.fillText(candidate.candidate_id || "TARGET", cx, cy - 15);
    }
  }

  // hover readout: evaluated at the cursor, not at the nearest candidate
  wrap.onmousemove = (e) => {
    const r = wrap.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (!hud) return;
    if (mx < f.pad.l || mx > w - f.pad.r || my < f.pad.t || my > h - f.pad.b) { hud.style.display = "none"; return; }
    const x = f.fromX(mx), v = at(x), pr = gp.predict(v), nov = gp.novelty(v);
    const inEnv = x >= env[0] && x <= env[1];
    hud.style.display = "block";
    hud.innerHTML = `
      <div style="font-weight:700; color:var(--ink); margin-bottom:2px;">${A.fmt(x)} · ${inEnv ? '<span style="color:var(--good);">inside flight data</span>' : '<span style="color:#f59e0b;">extrapolating</span>'}</div>
      <div style="color:#38bdf8;">μ = <b>${pr.mean.toFixed(3)}</b> mm²/s</div>
      <div style="color:#38bdf8;">Epistemic ±2σ_f = <b>${(2 * pr.sigmaF).toFixed(3)}</b></div>
      <div style="color:#a855f7;">Predictive ±2σ (σ_f⊕σ_n) = <b>${(2 * pr.sigmaTotal).toFixed(3)}</b></div>
      <div style="color:var(--ink-2); font-size:10px;">EIG ${pr.eigBits.toFixed(3)} bits · nearest run ${nov.ratio.toFixed(1)}× typical spacing</div>`;
  };
  wrap.onmouseleave = () => { if (hud) hud.style.display = "none"; };
  return { flightShown: shown };
}

/* ============================================================ 2D UNCERTAINTY MAP ============================================================ */
const STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];   // viridis-like
function cmap(u) {
  const t = clamp01(u) * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(t)), f = t - i;
  return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f));
}
const NX = 64, NY = 40;

function computeGrid(gp, d0, metric) {
  const PA = AXES.P, OA = AXES.O2, g = new Float32Array(NX * NY);
  let max = 0, min = Infinity;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const p = PA.lo + (i / (NX - 1)) * (PA.hi - PA.lo), o2 = OA.hi - (j / (NY - 1)) * (OA.hi - OA.lo);
    const pr = gp.predict([p, o2, d0]);
    const v = metric === "mean" ? pr.mean : pr.sigmaF;
    g[j * NX + i] = v; if (v > max) max = v; if (v < min) min = v;
  }
  return { g, max, min };
}
/** Max of the map for a GP — used to keep the colour scale fixed when comparing before/after a what-if. */
export const heatmapMax = (gp, d0, metric = "sigmaF") => computeGrid(gp, d0, metric).max;

export function drawHeatmap({ canvas, wrap, hud, gp, d0, candidate, candidates = [], metric = "sigmaF", scaleMax = null }) {
  const { ctx, w, h } = setup(canvas, wrap, 340);
  const PA = AXES.P, OA = AXES.O2, pad = { l: 60, r: 78, t: 22, b: 45 };
  const { g, max, min } = computeGrid(gp, d0, metric);
  const vmax = scaleMax ?? max, vmin = metric === "mean" ? min : 0;

  const f = frame(ctx, {
    w, h, pad, xr: [PA.lo, PA.hi], yr: [OA.lo, OA.hi], grid: false,
    xTicks: ticks(PA.lo, PA.hi, 5), yTicks: ticks(OA.lo, OA.hi, 6), xFmt: PA.fmt, yFmt: OA.fmt,
    xLabel: PA.label, yLabel: "Oxidizer X_O₂",
  });
  const off = document.createElement("canvas"); off.width = NX; off.height = NY;
  const octx = off.getContext("2d"), img = octx.createImageData(NX, NY);
  for (let k = 0; k < NX * NY; k++) {
    const [r, gg, b] = cmap((g[k] - vmin) / ((vmax - vmin) || 1));
    img.data.set([r, gg, b, 255], k * 4);
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, pad.l, pad.t, f.plotW, f.plotH);

  // demonstrated flight envelope (bounding box of real runs)
  const env = gp.envelope();
  ctx.setLineDash([5, 4]); ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.2;
  ctx.strokeRect(f.toX(env.P[0]), f.toY(env.O2[1]), f.toX(env.P[1]) - f.toX(env.P[0]), f.toY(env.O2[0]) - f.toY(env.O2[1]));
  ctx.setLineDash([]);

  // real flight runs at similar d₀, hypothetical observations, candidates
  gp.m.X.forEach((x, i) => {
    if (Math.abs(x[2] - d0) > 0.75) return;
    const px = f.toX(x[0]), py = f.toY(x[1]);
    ctx.beginPath();
    if (i >= gp.nBase) { ctx.rect(px - 5, py - 5, 10, 10); ctx.strokeStyle = C.hypo; ctx.lineWidth = 2; ctx.stroke(); }
    else { ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1; ctx.stroke(); }
  });
  const diamond = (px, py, s, fill, stroke) => {
    ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI / 4);
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(-s, -s, 2 * s, 2 * s); }
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.strokeRect(-s, -s, 2 * s, 2 * s); ctx.restore();
  };
  candidates.forEach((c) => {
    const v = candVec(c);
    if (!v || Math.abs(v[2] - d0) > 0.6 || !c.isFeasible) return;
    diamond(f.toX(v[0]), f.toY(v[1]), 3.5, "rgba(255,121,31,0.9)", "#000");
  });
  const cv = candVec(candidate);
  if (cv) diamond(f.toX(cv[0]), f.toY(cv[1]), 6, Math.abs(cv[2] - d0) <= 0.6 ? C.cand : null, "#fff");

  // colour bar
  const bx = w - pad.r + 18, bw = 12;
  for (let y = 0; y < f.plotH; y++) { const [r, gg, b] = cmap(1 - y / f.plotH); ctx.fillStyle = `rgb(${r},${gg},${b})`; ctx.fillRect(bx, pad.t + y, bw, 1); }
  ctx.fillStyle = C.text; ctx.font = "10px monospace"; ctx.textAlign = "left";
  ctx.fillText(vmax.toFixed(3), bx + bw + 4, pad.t + 8);
  ctx.fillText(vmin.toFixed(3), bx + bw + 4, pad.t + f.plotH);
  ctx.fillText(metric === "mean" ? "μ K" : "σ_f", bx, pad.t - 8);

  wrap.onmousemove = (e) => {
    const r = wrap.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (!hud) return;
    if (mx < pad.l || mx > pad.l + f.plotW || my < pad.t || my > pad.t + f.plotH) { hud.style.display = "none"; return; }
    const v = [f.fromX(mx), f.fromY(my), d0], pr = gp.predict(v), nov = gp.novelty(v);
    hud.style.display = "block";
    hud.innerHTML = `
      <div style="font-weight:700; color:var(--ink);">P ${v[0].toFixed(2)} atm · O₂ ${(v[1] * 100).toFixed(1)}% · d₀ ${d0.toFixed(1)} mm</div>
      <div style="color:#38bdf8;">μ = <b>${pr.mean.toFixed(3)}</b> mm²/s</div>
      <div style="color:#a855f7;">σ_f (epistemic) = <b>${pr.sigmaF.toFixed(3)}</b> mm²/s</div>
      <div style="color:var(--ink-2); font-size:10px;">EIG ${pr.eigBits.toFixed(3)} bits · ${nov.ratio.toFixed(1)}× typical run spacing from nearest flight run</div>`;
  };
  wrap.onmouseleave = () => { if (hud) hud.style.display = "none"; };
  return { max, min };
}

/* ============================================================ BENCHMARK CURVES ============================================================ */
const STRAT_COLORS = { RANDOM: "#94a3b8", BAYESIAN_EIG: "#22c55e", SPACE_FILLING: "#f59e0b" };

export function drawBenchmarkCurves({ canvas, wrap, bench }) {
  if (!canvas || !wrap || !bench?.strategies) return;
  const { ctx, w, h } = setup(canvas, wrap, 220);
  const S = bench.strategies, steps = bench.protocol.n_steps;
  const lo = Math.min(...Object.values(S).flatMap((s) => s.trajectory_mean.map((m, i) => m - s.trajectory_std[i])));
  const hi = Math.max(...Object.values(S).flatMap((s) => s.trajectory_mean.map((m, i) => m + s.trajectory_std[i])));
  const yMin = Math.max(0, Math.floor(lo * 100) / 100), yMax = Math.ceil(hi * 100) / 100;
  const f = frame(ctx, {
    w, h, pad: { l: 60, r: 130, t: 16, b: 40 }, xr: [0, steps], yr: [yMin, yMax],
    xTicks: Array.from({ length: steps + 1 }, (_, i) => i), yTicks: ticks(yMin, yMax, 4),
    xFmt: (v) => String(v), yFmt: (v) => v.toFixed(3), xLabel: "Acquisition step", yLabel: "Held-out RMSE (mm²/s)",
  });
  Object.entries(S).forEach(([name, s], k) => {
    const col = STRAT_COLORS[name] || "#fff";
    ctx.beginPath();
    s.trajectory_mean.forEach((m, i) => { const X = f.toX(i), Y = f.toY(m + s.trajectory_std[i]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    for (let i = s.trajectory_mean.length - 1; i >= 0; i--) ctx.lineTo(f.toX(i), f.toY(s.trajectory_mean[i] - s.trajectory_std[i]));
    ctx.closePath(); ctx.globalAlpha = 0.13; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    s.trajectory_mean.forEach((m, i) => { const X = f.toX(i), Y = f.toY(m); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.font = "10.5px monospace"; ctx.textAlign = "left";
    ctx.fillText(name, w - 124, 26 + k * 16);
  });
  ctx.fillStyle = C.text; ctx.font = "9.5px monospace"; ctx.textAlign = "left";
  ctx.fillText("mean ± 1 SD over reps", w - 124, 26 + Object.keys(S).length * 16 + 6);
}

