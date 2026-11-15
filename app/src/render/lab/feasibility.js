// src/render/lab/feasibility.js
// Feasibility is now derived from (a) the flight-data envelope actually present in the ledger and
// (b) a small set of facility facts whose sources were checked. Replaces DOCUMENTED_HARDWARE_LIMITS.

export const FACILITY_REFERENCES = {
  ISS_CIR_CHAMBER: {
    facility: "ISS Combustion Integrated Rack (CIR) + MDCA insert",
    min_pressure_atm: 0.02,
    max_pressure_atm: 3.0,
    source: "NASA Combustion Integrated Rack facility description: chamber operates from 0.02 atm to 3 atm",
    source_status: "SECONDARY — seen quoted on Wikipedia; open the nasa.gov CIR page and cite that before submitting",
  },
  ZERO_G_DROP_TOWER: {
    facility: "NASA Glenn Zero Gravity Research Facility",
    microgravity_s: 5.18,
    source: "NASA/TM—1999-209641, Zero Gravity Research Facility User's Guide (Thompson); NASA Glenn facility page",
    source_status: "VERIFIED that the document exists and the NASA page states 5.18 s; the old ID 'NASA TM-107000' could not be found",
  },
  EXPLORATION_ATMOSPHERE: {
    target_pressure_atm: 0.57,
    target_o2_mole_fraction: 0.34,
    source: "NASA exploration atmosphere (≈8.2 psia, 34% O₂)",
    source_status: "UNVERIFIED — find the exact NASA document number before citing 'NASA-STD-3001 Vol 2 / SP-2010-3407'",
  },
  REMOVED: [
    "NASA/TP-2017-219299 — no such report found",
    "NASA TM-107000 — not found (real drop-tower guide is NASA/TM-1999-209641)",
    "CIR minimum pressure 0.70 atm / max O₂ 30% — contradicted by FLEX runs at 0.5 atm and a 33.4% O₂ heptane burn at 0.713 atm",
    "Drop-tower pressure/O₂ limits (0.30–2.5 atm, 40% O₂) — no source found",
  ],
};

// ILLUSTRATIVE PLACEHOLDERS (relative cost per experiment). Replace with real numbers or leave the
// "EIG per cost" objective off. They are not from any source.
export const FACILITY_COST_ASSUMED = {
  FEASIBLE_SPACEFLIGHT: 1.0,
  OUTSIDE_FLIGHT_ENVELOPE: 2.0,
  HYPOTHETICAL_FRONTIER: 2.0,
  UNSUPPORTED: Infinity,
};

const inRange = (v, r, eps) => v >= r[0] - eps && v <= r[1] + eps;

/**
 * @param data   { pressure_atm, o2_mole_fraction, droplet_diameter_mm, predicted_burn_rate_k?, model_status?, error_message? }
 * @param envelope optional { P:[min,max], O2:[min,max], D0:[min,max] } from GPR.envelope() (real flight runs only)
 * Statuses: FEASIBLE_SPACEFLIGHT | OUTSIDE_FLIGHT_ENVELOPE | HYPOTHETICAL_FRONTIER | UNSUPPORTED
 */
export function evaluateCandidateFeasibility(data, userConstraints, activeGravity = 0.0, envelope = null) {
  const violations = [];
  const p = data.pressure_atm, o2 = data.o2_mole_fraction, d0 = data.droplet_diameter_mm;
  const CIR = FACILITY_REFERENCES.ISS_CIR_CHAMBER;
  const tower = FACILITY_REFERENCES.ZERO_G_DROP_TOWER;
  const fail = (recommendedFacility, feasibilitySource) => ({
    feasibilityStatus: "UNSUPPORTED", isFeasible: false, violations, recommendedFacility, feasibilitySource,
  });

  // 1. user constraint limits
  if (p !== null && p > userConstraints.maxP + 0.005) violations.push(`Pressure ${p.toFixed(2)} atm exceeds user limit of ${userConstraints.maxP.toFixed(2)} atm`);
  if (o2 !== null && o2 > userConstraints.maxO2 + 0.005) violations.push(`Oxygen ${(o2 * 100).toFixed(1)}% exceeds user cap of ${(userConstraints.maxO2 * 100).toFixed(1)}%`);
  if (d0 !== null && d0 > userConstraints.maxD0 + 0.05) violations.push(`Diameter ${d0.toFixed(1)} mm exceeds user limit of ${userConstraints.maxD0.toFixed(1)} mm`);

  // 2. model support
  if (data.model_status === "UNSUPPORTED_FUEL" || data.error_message) {
    violations.push(data.error_message || "Model not calibrated for selected fuel");
    return fail("Not applicable", "No empirical flight calibration for fuel");
  }
  if (activeGravity >= 1.0) {
    violations.push("1.0g terrestrial buoyancy is uncalibrated. Surrogate is valid only for microgravity spherical droplet combustion.");
    return fail("Terrestrial rig (uncalibrated)", "Microgravity flight-record calibration only");
  }
  if (p === null || o2 === null || d0 === null || p < 0.2 || o2 < 0.10 || o2 > 0.45) {
    violations.push("Parameters exceed allowable physics and chamber limits");
    return fail("Not applicable", "Chamber envelope exceeded");
  }
  if (p > CIR.max_pressure_atm) {
    violations.push(`Pressure ${p.toFixed(2)} atm exceeds the CIR chamber capability (${CIR.max_pressure_atm} atm)`);
    return fail("Not applicable", CIR.source);
  }
  if (violations.length > 0) return fail("Constraint violation", "User experimental constraints");

  // 3. drop-tower suitability uses the model's own burn time: t_burn ≈ d0² / K
  const K = data.predicted_burn_rate_k;
  const burnTimeS = K > 0 ? (d0 * d0) / K : null;
  const groundOption = { viable: burnTimeS !== null && burnTimeS <= tower.microgravity_s, burnTimeS, microgravity_s: tower.microgravity_s };
  const groundNote = burnTimeS === null ? ""
    : groundOption.viable ? ` Drop tower: full burn fits (≈${burnTimeS.toFixed(1)} s ≤ ${tower.microgravity_s} s).`
    : ` Drop tower: model burn time ≈${burnTimeS.toFixed(1)} s exceeds ${tower.microgravity_s} s of microgravity (partial burn only).`;

  // 4. hypothetical frontier (exploration atmosphere / partial gravity)
  const ex = FACILITY_REFERENCES.EXPLORATION_ATMOSPHERE;
  const isExplorationAtm = Math.abs(p - ex.target_pressure_atm) < 0.06 && Math.abs(o2 - ex.target_o2_mole_fraction) < 0.05;
  const isPartialG = activeGravity > 0.01 && activeGravity < 0.99;
  if (isExplorationAtm || isPartialG) {
    return {
      feasibilityStatus: "HYPOTHETICAL_FRONTIER", isFeasible: true, violations: [],
      recommendedFacility: isPartialG
        ? "Lunar/Martian surface demonstration (no partial-gravity flight data exists)"
        : "ISS CIR / MDCA (chamber-capable, new test matrix)" + groundNote,
      feasibilitySource: isPartialG ? "Partial gravity: extrapolation beyond all flight data" : `${ex.source} — ${ex.source_status}`,
      groundOption, burnTimeS,
    };
  }

  // 5. demonstrated flight envelope (bounding box of real runs)
  if (envelope) {
    const eps = { P: 0.02, O2: 0.005, D0: 0.05 }, out = [];
    if (!inRange(p, envelope.P, eps.P)) out.push(`P = ${p.toFixed(2)} atm outside flown ${envelope.P[0].toFixed(2)}–${envelope.P[1].toFixed(2)} atm`);
    if (!inRange(o2, envelope.O2, eps.O2)) out.push(`O₂ = ${(o2 * 100).toFixed(0)}% outside flown ${(envelope.O2[0] * 100).toFixed(0)}–${(envelope.O2[1] * 100).toFixed(0)}%`);
    if (!inRange(d0, envelope.D0, eps.D0)) out.push(`d₀ = ${d0.toFixed(1)} mm outside flown ${envelope.D0[0].toFixed(1)}–${envelope.D0[1].toFixed(1)} mm`);
    if (out.length) {
      return {
        feasibilityStatus: "OUTSIDE_FLIGHT_ENVELOPE", isFeasible: true, violations: [],
        recommendedFacility: "ISS CIR / MDCA after new test-matrix qualification" + groundNote,
        feasibilitySource: out.join("; "),
        scientificRationale: `Outside the conditions present in the flight archive: ${out.join("; ")}. The chamber itself is capable (${CIR.min_pressure_atm}–${CIR.max_pressure_atm} atm), but this point has not been flown.${groundNote}`,
        groundOption, burnTimeS,
      };
    }
  }

  return {
    feasibilityStatus: "FEASIBLE_SPACEFLIGHT", isFeasible: true, violations: [],
    recommendedFacility: "ISS CIR / MDCA insert",
    feasibilitySource: envelope
      ? "Inside the demonstrated flight-data envelope (bounding box of ledger runs)"
      : "CIR chamber capability only — no flight envelope loaded",
    groundOption, burnTimeS,
  };
}

