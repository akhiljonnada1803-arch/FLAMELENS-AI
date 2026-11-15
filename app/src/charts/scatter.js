import { el, text, linear, axes } from "../core/svg.js";
import { bindTip } from "../core/tooltip.js";
import { cssVar, fmt, FUEL, END } from "../core/dom.js";

export function marker(g, cx, cy, r, color, end, surface) {
  if (end === "Extinction") return el("circle", { cx, cy, r: r - 0.5, fill: surface, stroke: color, "stroke-width": 2 }, g);
  if (end === "Disruption") {
    return el("path", { d: `M${cx - r},${cy} L${cx},${cy - r - 1} L${cx + r},${cy} L${cx},${cy + r + 1}Z`, fill: color, stroke: surface, "stroke-width": 1.5 }, g);
  }
  return el("circle", { cx, cy, r, fill: color, stroke: surface, "stroke-width": 1.5 }, g);
}

export function legendHTML(withShapes = true) {
  const fuels = `
    <div class="legend-group">
      <span class="legend-group-title">Fuel</span>
      <span class="legend-chip fuel-methanol"><span class="legend-dot" style="background:${cssVar(FUEL.Methanol.color) || '#20B9E8'};"></span>Methanol</span>
      <span class="legend-chip fuel-heptane"><span class="legend-dot" style="background:${cssVar(FUEL.Heptane.color) || '#FF791F'};"></span>Heptane</span>
    </div>
  `;
  if (!withShapes) return `<div class="legend-bar">${fuels}</div>`;
  const c = cssVar("--color-text-muted") || "#CBD5E1";
  const outcomes = `
    <div class="legend-divider"></div>
    <div class="legend-group">
      <span class="legend-group-title">Termination Mode</span>
      <span class="legend-chip"><span class="legend-dot" style="background:${c};"></span>Complete Burn</span>
      <span class="legend-chip"><span class="legend-ring" style="border-color:${c};"></span>Extinction</span>
      <span class="legend-chip"><span class="legend-diamond" style="background:${c};"></span>Disruption</span>
    </div>
  `;
  return `<div class="legend-bar">${fuels}${outcomes}</div>`;
}

/** Burning rate K vs O₂ fraction: color = fuel, marker style = end mode. */
export function drawScatter(svg, rows, onPick) {
  svg.innerHTML = "";
  const W = 920;
  const H = 400;
  const m = { l: 64, r: 24, t: 32, b: 56 };
  const x = linear(0.1, 0.36, m.l, W - m.r);
  const y = linear(0, 1.1, H - m.b, m.t);
  axes(svg, {
    m, W, H, x, y,
    xt: [0.12, 0.15, 0.18, 0.21, 0.24, 0.27, 0.3, 0.33],
    yt: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
    xLabel: "Ambient O₂ Mole Fraction",
    yLabel: "Burning Rate K (mm²/s)",
    xf: (v) => v.toFixed(2),
    yf: (v) => v.toFixed(1),
  });
  el("line", { x1: x(0.209), x2: x(0.209), y1: m.t, y2: H - m.b, stroke: cssVar("--color-cyan") || "#20B9E8", "stroke-dasharray": "4 4", class: "ref-line", opacity: "0.75" }, svg);
  text(svg, x(0.209) + 8, m.t + 12, "air · 20.9%", { class: "ref-line-label" });

  const surface = cssVar("--panel-solid");
  const g = el("g", {}, svg);
  rows.forEach((r) => {
    const jit = (((r.n * 7919) % 100) / 100) * 0.004 - 0.002;
    const cx = x(r.o2 + jit);
    const cy = y(r.K);
    const mk = marker(g, cx, cy, 4.5, cssVar(FUEL[r.fuel].color), r.end, surface);
    const hit = el("circle", { cx, cy, r: 9, fill: "transparent" }, g);
    if (onPick) {
      hit.style.cursor = "pointer";
      hit.addEventListener("click", () => onPick(r));
    }
    bindTip(
      hit,
      () => `<b>FLEX #${r.n}</b> · ${FUEL[r.fuel].es}<br>O₂ ${fmt(r.o2)} · ${fmt(r.P)} atm<br>CO₂ ${fmt(r.co2)} · He ${fmt(r.he)}<br>d₀ ${fmt(r.d0)} mm · K ${fmt(r.K)} mm²/s<br>${END[r.end] || r.end}${r.dext ? ` at ${fmt(r.dext)} mm` : ""}${onPick ? `<br><span class="dim">click to view run</span>` : ""}`,
      { on: () => mk.setAttribute("transform", `translate(${cx} ${cy}) scale(1.45) translate(${-cx} ${-cy})`), off: () => mk.removeAttribute("transform") },
    );
  });
}
