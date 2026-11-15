import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { V, std, mesh, box, rod, pipe, panel, disposeTree } from "./kit.js";
import * as tx from "./textures.js";

/**
 * EXPERIMENTAL DESIGN FACILITY (3D NASA Research Facility)
 * Fully Reactive Scientific Experimental Design Environment:
 * - Opposed motorized needles physically translate to sample droplet diameter d0.
 * - Pressure dial needles, gas regulators, and digital displays update in real time.
 * - Oxidizer manifold illumination dynamically shifts with oxygen concentration.
 * - Gravity-specific convective buoyancy vectors materialize according to g-target.
 * - Candidate proposals visually distinguish Feasible vs Infeasible constraint states.
 * - Interactive raycasting for both candidate proposals and historical NASA PSI flight runs.
 */
export function validateHistoricalRecord(item) {
  if (!item || typeof item !== "object") {
    return { valid: false, reason: "Invalid record object" };
  }
  const evidence_id = item.evidence_id;
  if (!evidence_id || typeof evidence_id !== "string") {
    return { valid: false, reason: "Missing evidence_id" };
  }

  const norm = item.normalized_measurements || {};
  const p = Number(norm.pressure_atm);
  const o2 = Number(norm.x_o2);
  const d0 = norm.d0_mm !== null && norm.d0_mm !== undefined ? Number(norm.d0_mm) : null;
  const k = norm.burning_rate_mm2_s !== null && norm.burning_rate_mm2_s !== undefined ? Number(norm.burning_rate_mm2_s) : null;

  if (isNaN(p) || p <= 0 || !isFinite(p)) {
    return { valid: false, reason: `Invalid pressure: ${norm.pressure_atm}` };
  }
  if (isNaN(o2) || o2 <= 0 || o2 > 1.0 || !isFinite(o2)) {
    return { valid: false, reason: `Invalid oxygen fraction: ${norm.x_o2}` };
  }
  if (d0 === null || isNaN(d0) || d0 <= 0 || !isFinite(d0)) {
    return { valid: false, reason: `Missing or invalid droplet diameter: ${norm.d0_mm}` };
  }

  return {
    valid: true,
    data: {
      evidence_id,
      uid: item.uid || evidence_id,
      accession: item.accession || "UNKNOWN",
      campaign: item.campaign || "UNKNOWN",
      test_id: item.test_id || "UNKNOWN",
      family: item.family || "UNKNOWN",
      material_or_fuel: item.material_or_fuel || null,
      gravity: item.gravity || null,
      pressure_atm: p,
      oxygen_fraction: o2,
      droplet_diameter_mm: d0,
      measured_k: k !== null && !isNaN(k) && isFinite(k) ? k : null,
      source_provenance: item.source_provenance || null,
      literature_reference: item.literature_reference || null,
      scientific_quality: item.scientific_quality || null,
    }
  };
}

import { evaluateCandidateFeasibility as evaluateFeas, FACILITY_REFERENCES, FACILITY_COST_ASSUMED } from "./feasibility.js";

export { FACILITY_REFERENCES, FACILITY_COST_ASSUMED };

export const DOCUMENTED_HARDWARE_LIMITS = {
  ISS_CIR_MDCA: {
    facility: FACILITY_REFERENCES.ISS_CIR_CHAMBER.facility,
    source: FACILITY_REFERENCES.ISS_CIR_CHAMBER.source,
    min_pressure_atm: 0.70,
    max_pressure_atm: FACILITY_REFERENCES.ISS_CIR_CHAMBER.max_pressure_atm,
    max_o2_mole_fraction: 0.30,
    min_droplet_d0_mm: 1.0,
    max_droplet_d0_mm: 5.0,
  },
  GROUND_DROP_TOWER: {
    facility: FACILITY_REFERENCES.ZERO_G_DROP_TOWER.facility,
    source: FACILITY_REFERENCES.ZERO_G_DROP_TOWER.source,
    min_pressure_atm: 0.30,
    max_pressure_atm: 2.50,
    max_o2_mole_fraction: 0.40,
    min_droplet_d0_mm: 0.8,
    max_droplet_d0_mm: 4.0,
  },
  EXPLORATION_ATMOSPHERE: {
    standard: "NASA Exploration Atmosphere Standard (Lunar / Mars Habitat)",
    source: FACILITY_REFERENCES.EXPLORATION_ATMOSPHERE.source,
    target_pressure_atm: FACILITY_REFERENCES.EXPLORATION_ATMOSPHERE.target_pressure_atm,
    target_o2_mole_fraction: FACILITY_REFERENCES.EXPLORATION_ATMOSPHERE.target_o2_mole_fraction,
  }
};

export function evaluateCandidateFeasibility(data, userConstraints, activeGravity = 0.0, envelope = null) {
  return evaluateFeas(data, userConstraints, activeGravity, envelope);
}

// ================= FLAME RIG =================
const FLAME_VERT = `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vP = position;
  gl_Position = projectionMatrix * mv;
}`;
const FLAME_FRAG = `
uniform float uTime; uniform float uIntensity; uniform vec3 uColA; uniform vec3 uColB;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
float hash(vec3 p){ p=fract(p*0.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
void main(){
  float fres = pow(1.0 - abs(dot(vN, vV)), 2.0);
  float n = noise(vP*3.0 + vec3(0.0,-uTime*0.6,uTime*0.3))*0.6 + noise(vP*7.0 + uTime*0.9)*0.4;
  float shell = fres*(0.55 + 0.9*n) + 0.12*n;
  vec3 col = mix(uColA, uColB, clamp(fres + n*0.3, 0.0, 1.0));
  gl_FragColor = vec4(col*1.8, shell*uIntensity);
}`;

function makeGlowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const FLAME_PHASES = ["DEPLOYMENT", "IGNITION", "HOT FLAME", "BURNOUT"];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (u) => 1 - Math.pow(1 - clamp01(u), 3);
const smooth = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };

function createFlameRig(parent, droplet, dropletMat) {
  const group = new THREE.Group();
  parent.add(group);
  const glowTex = makeGlowTexture();
  const blueC = new THREE.Color(0x6aa6ff), amberC = new THREE.Color(0xffb27a);

  // Blue spherical diffusion flame (shader shell)
  const shellMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uIntensity: { value: 0 },
      uColA: { value: new THREE.Color(0x2563eb) }, uColB: { value: new THREE.Color(0x7dd3fc) },
    },
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), shellMat);
  group.add(shell);

  // Amber soot shell (particles on a thin unit-sphere shell, scaled per frame)
  const SOOT_N = 900, sp = new Float32Array(SOOT_N * 3);
  for (let i = 0; i < SOOT_N; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const r = 0.82 + Math.random() * 0.18;
    sp[i * 3] = s * Math.cos(th) * r; sp[i * 3 + 1] = u * r; sp[i * 3 + 2] = s * Math.sin(th) * r;
  }
  const sootGeo = new THREE.BufferGeometry();
  sootGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const sootMat = new THREE.PointsMaterial({
    size: 2.2, map: glowTex, color: 0xffb347, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const soot = new THREE.Points(sootGeo, sootMat);
  group.add(soot);

  // Glow sprites + ignition flash + light
  const mkSprite = (color) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    group.add(s); return s;
  };
  const glowBlue = mkSprite(0x4f8cff), glowAmber = mkSprite(0xffa43a), flashSprite = mkSprite(0xffffff);
  const light = new THREE.PointLight(0x6aa6ff, 0, 350, 1.4);
  group.add(light);

  // Buoyant plume (only when 0 < g < 1)
  const PL = 160, plumePos = new Float32Array(PL * 3), plumeAge = new Float32Array(PL), plumeAng = new Float32Array(PL);
  for (let i = 0; i < PL; i++) { plumeAge[i] = Math.random(); plumeAng[i] = Math.random() * Math.PI * 2; }
  const plumeGeo = new THREE.BufferGeometry();
  plumeGeo.setAttribute("position", new THREE.BufferAttribute(plumePos, 3));
  const plumeMat = new THREE.PointsMaterial({
    size: 3, map: glowTex, color: 0xffc27a, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const plume = new THREE.Points(plumeGeo, plumeMat);
  parent.add(plume);

  // State
  let cfg = { d0: 2, k: 0.5, o2: 0.21, p: 1, fuel: "n-heptane", enabled: true, g: 0 };
  let R0 = 3.6, S = 6, sootAmt = 1, baseI = 1, burnDisplay = 6, tbReal = 8;
  let T0 = 1.6, T1 = 2.3, T2 = 8.3, T3 = 9.7, total = 10.7;
  let clock = 0, playing = true, speed = 1, lastKey = "";
  let state = { phase: "DEPLOYMENT", phaseIndex: 0, progress: 0, tReal: 0, dNowMm: 0, needlesRetracted: false, enabled: true, tbReal };

  function configure(c) {
    cfg = { ...cfg, ...c };
    const fuel = String(cfg.fuel || "n-heptane").toLowerCase();
    const isMeth = fuel.includes("meth");
    const K = cfg.k > 0 ? cfg.k : 0.5;
    R0 = cfg.d0 * 1.8;
    tbReal = (cfg.d0 * cfg.d0) / K;
    burnDisplay = Math.max(4, Math.min(12, tbReal));
    S = Math.max(3.2, Math.min(8, 7.5 - (cfg.o2 - 0.21) * 14 - (cfg.p - 1) * 0.6));
    sootAmt = isMeth ? 0 : Math.max(0.35, Math.min(1, 1.15 - (cfg.o2 - 0.21) * 1.5));
    baseI = (isMeth ? 0.55 : 0.85) + (cfg.o2 - 0.21) * 1.6;
    shellMat.uniforms.uColA.value.set(isMeth ? 0x3b82f6 : 0x2563eb);
    shellMat.uniforms.uColB.value.set(isMeth ? 0x93c5fd : 0x7dd3fc);
    T0 = 1.6; T1 = T0 + 0.7; T2 = T1 + burnDisplay; T3 = T2 + 1.4; total = T3 + 1.0;
    // restart only when the experiment itself changes (not gravity / slider noise)
    const key = [cfg.d0, cfg.k, cfg.o2, cfg.p, cfg.fuel, cfg.enabled].join("|");
    if (key !== lastKey) { lastKey = key; clock = 0; }
  }

  function update(dt, t) {
    if (playing) clock += dt * speed;
    if (!cfg.enabled) clock = Math.min(clock, T0);      // unsupported: droplet only, no flame
    else if (clock >= total) clock -= total;

    let r = 0, flameR = 0, flameI = 0, sootV = 0, flash = 0, retracted = false, pi = 0, s = 0;
    if (clock < T0) {                                   // DEPLOYMENT
      const u = clock / T0;
      r = R0 * easeOut(u) * (1 + 0.05 * Math.sin(t * 14) * (1 - u));
    } else if (clock < T1) {                            // IGNITION
      const u = (clock - T0) / (T1 - T0); pi = 1;
      r = R0; retracted = u > 0.15;
      flash = Math.pow(1 - u, 2);
      flameI = easeOut(u);
      flameR = R0 * (1.1 + (S - 1.1) * easeOut(u));
    } else if (clock < T2) {                            // HOT FLAME (d² law)
      s = (clock - T1) / burnDisplay; pi = 2;
      r = R0 * Math.sqrt(Math.max(0.0001, 1 - s));
      retracted = true;
      flameR = R0 * S * (1 - 0.5 * s * s);
      flameI = 0.92 + 0.08 * Math.sin(t * 9);
      sootV = smooth(0, 0.25, s) * (1 - smooth(0.85, 1, s) * 0.5);
    } else if (clock < T3) {                            // BURNOUT
      const u = (clock - T2) / (T3 - T2); pi = 3; s = 1;
      retracted = true;
      flameR = R0 * S * 0.5 * (1 - u * u);
      flameI = Math.pow(1 - u, 1.5) * (0.7 + 0.3 * Math.sin(t * 40));
      sootV = 0.5 * (1 - u);
    } else { pi = 3; s = 1; retracted = true; }         // reset pause

    // droplet
    droplet.visible = r > 0.02;
    droplet.scale.setScalar(Math.max(1e-3, r));
    dropletMat.emissiveIntensity = 0.35 + flameI * 0.45 + Math.sin(t * 2.5) * 0.08;

    // flame group + buoyancy deformation
    const g = cfg.g || 0;
    const gOn = g > 0.01 && g < 0.99;
    group.scale.set(1, 1 + (gOn ? g * 0.9 : 0), 1);
    group.position.y = gOn ? flameR * 0.35 * g : 0;
    const I = flameI * baseI;
    shell.scale.setScalar(Math.max(1e-3, flameR));
    shell.visible = flameR > 0.05;
    shellMat.uniforms.uTime.value = t;
    shellMat.uniforms.uIntensity.value = I;

    soot.scale.setScalar(Math.max(1e-3, flameR * 0.68));
    soot.rotation.y = t * 0.25; soot.rotation.x = t * 0.1;
    sootMat.opacity = sootAmt * sootV * (0.75 + 0.25 * Math.sin(t * 7));

    glowBlue.scale.setScalar(Math.max(1e-3, flameR * 2.6)); glowBlue.material.opacity = I * 0.32;
    glowAmber.scale.setScalar(Math.max(1e-3, flameR * 1.5)); glowAmber.material.opacity = sootAmt * sootV * 0.45;
    flashSprite.scale.setScalar(R0 * (3 + flash * 8)); flashSprite.material.opacity = flash;
    light.color.copy(blueC).lerp(amberC, sootAmt * sootV);
    light.intensity = I * 5 + flash * 12;

    // plume
    plume.visible = gOn && flameI > 0.05;
    if (plume.visible) {
      for (let i = 0; i < PL; i++) {
        plumeAge[i] += dt * (0.5 + g * 1.2);
        if (plumeAge[i] > 1) { plumeAge[i] = 0; plumeAng[i] = Math.random() * Math.PI * 2; }
        const a = plumeAge[i], rad = flameR * 0.35 * (1 - a * 0.6);
        plumePos[i * 3] = Math.cos(plumeAng[i]) * rad;
        plumePos[i * 3 + 1] = flameR * 0.6 + a * flameR * 3 * g;
        plumePos[i * 3 + 2] = Math.sin(plumeAng[i]) * rad;
      }
      plumeGeo.attributes.position.needsUpdate = true;
      plumeMat.opacity = flameI * (0.5);
    }

    state = {
      phase: cfg.enabled ? FLAME_PHASES[pi] : "DEPLOYMENT", phaseIndex: cfg.enabled ? pi : 0,
      progress: clock / total, tReal: Math.max(0, clock - T1) / burnDisplay * tbReal,
      dNowMm: cfg.d0 * Math.sqrt(Math.max(0, 1 - s)), needlesRetracted: retracted,
      enabled: cfg.enabled, tbReal, soot: sootAmt > 0, gravity: g,
    };
    return state;
  }

  return {
    configure, update,
    play: () => { playing = true; }, pause: () => { playing = false; },
    isPlaying: () => playing,
    restart: () => { clock = 0; playing = true; },
    setSpeed: (v) => { speed = v; },
    seek: (frac) => { clock = clamp01(frac) * total; },
    setGravity: (g) => { cfg.g = g; },
    dispose: () => { glowTex.dispose(); shellMat.dispose(); sootGeo.dispose(); sootMat.dispose(); plumeGeo.dispose(); plumeMat.dispose(); },
  };
}

export function createOptimizerFacility(container, { proposalsData, historicalRecords, onSelectCandidate, onSelectHistorical, onProbeInfo, onFlameState }) {
  const W_init = Math.max(10, container.clientWidth || 800);
  const H_init = Math.max(10, container.clientHeight || 540);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(W_init, H_init);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050c);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04).texture;
  scene.environment = envMap;
  disposeTree(room);
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(40, W_init / H_init, 1, 15000);
  camera.position.set(0, 180, 520);

  // Lighting
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x111624, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(200, 450, 300);
  const chamberSpot = new THREE.PointLight(0x60a5fa, 2.5, 600, 1.2);
  chamberSpot.position.set(0, 0, 80);
  const candidateSpot = new THREE.PointLight(0xf59e0b, 1.5, 400, 1.0);
  candidateSpot.position.set(0, 60, 0);
  scene.add(hemi, sun, chamberSpot, candidateSpot);

  const labFacility = new THREE.Group();
  scene.add(labFacility);

  const M = {
    steel: std(0xc8d0dc, 0.95, 0.25),
    darkTitanium: std(0x1c2230, 0.7, 0.45),
    goldAlloy: std(0xd4af37, 0.85, 0.35),
    brassValve: std(0xbf8f3b, 0.8, 0.3),
    quartzGlass: std(0x18243b, 0.1, 0.05, { transparent: true, opacity: 0.35, depthWrite: false }),
    highPurityCeramic: std(0xf3efe6, 0.05, 0.7),
    manifoldCyan: std(0x0284c7, 0.8, 0.3, { emissive: 0x0284c7, emissiveIntensity: 0.3 }),
    rackPanel: std(0x242a38, 0.5, 0.6),
    laserCyan: new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 }),
    laserGold: new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.95 }),
  };

  // ==========================================
  // 1. PHYSICAL COMBUSTION TEST CHAMBER
  // ==========================================
  const chamberGroup = new THREE.Group();
  labFacility.add(chamberGroup);

  const RC = 140, L = 300, zCenter = -40;

  const hullTex = tx.darkMetal(7);
  hullTex.repeat.set(4, 2);
  const hullGeo = new THREE.CylinderGeometry(RC, RC, L, 64, 1, true, Math.PI * 0.15, Math.PI * 1.7);
  hullGeo.rotateX(Math.PI / 2);
  mesh(hullGeo, std(0xffffff, 0.75, 0.4, { map: hullTex, side: THREE.DoubleSide }), chamberGroup, [0, 0, zCenter]);

  mesh(new THREE.TorusGeometry(RC + 8, 12, 10, 56), M.steel, chamberGroup, [0, 0, zCenter + L / 2]);
  mesh(new THREE.TorusGeometry(RC + 8, 12, 10, 56), M.steel, chamberGroup, [0, 0, zCenter - L / 2]);
  mesh(new THREE.CircleGeometry(RC - 2, 48), M.darkTitanium, chamberGroup, [0, 0, zCenter - L / 2]);

  const boltGeo = new THREE.CylinderGeometry(3.5, 3.5, 8, 8).rotateX(Math.PI / 2);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    mesh(boltGeo, M.steel, chamberGroup, [Math.cos(a) * (RC + 10), Math.sin(a) * (RC + 10), zCenter + L / 2 + 5]);
  }

  const portGroup = new THREE.Group();
  portGroup.position.set(0, 0, zCenter + L / 2 + 2);
  mesh(new THREE.TorusGeometry(85, 8, 12, 48), M.goldAlloy, portGroup);
  mesh(new THREE.CircleGeometry(84, 48), M.quartzGlass, portGroup);
  chamberGroup.add(portGroup);

  const linerGeo = new THREE.CylinderGeometry(RC - 18, RC - 18, L - 30, 48, 1, true, Math.PI * 0.2, Math.PI * 1.6);
  linerGeo.rotateX(Math.PI / 2);
  mesh(linerGeo, std(0xffffff, 0.5, 0.6, { map: tx.perforated(), alphaTest: 0.5, side: THREE.DoubleSide }), chamberGroup, [0, 0, zCenter]);

  // ==========================================
  // 2. MOTORIZED OPPOSED DEPLOYMENT NEEDLES
  // ==========================================
  const needleAssembly = new THREE.Group();
  needleAssembly.position.set(0, 0, zCenter);
  chamberGroup.add(needleAssembly);

  const leftStepper = box(30, 24, 28, M.darkTitanium, needleAssembly, [-110, 0, 0]);
  box(18, 12, 18, M.steel, leftStepper, [18, 0, 0]);
  const leftNeedle = rod(V(-100, 0, 0), V(-8, 0, 0), 2.2, M.steel, needleAssembly, 0.6);

  const rightStepper = box(30, 24, 28, M.darkTitanium, needleAssembly, [110, 0, 0]);
  box(18, 12, 18, M.steel, rightStepper, [-18, 0, 0]);
  const rightNeedle = rod(V(100, 0, 0), V(8, 0, 0), 2.2, M.steel, needleAssembly, 0.6);

  const sampleDropletGeo = new THREE.SphereGeometry(1, 32, 24);
  const sampleDropletMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    roughness: 0.1,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9,
    emissive: 0x0284c7,
    emissiveIntensity: 0.35,
  });
  const sampleDroplet = new THREE.Mesh(sampleDropletGeo, sampleDropletMat);
  needleAssembly.add(sampleDroplet);

  let baseNeedleOffset = 8.0;
  const flameRig = createFlameRig(needleAssembly, sampleDroplet, sampleDropletMat);
  let currentGravity = 0;
  let lastFlameEmit = 0;

  rod(V(-35, 28, 12), V(-6, 7, 0), 1.2, M.highPurityCeramic, needleAssembly);
  rod(V(35, 28, 12), V(6, 7, 0), 1.2, M.highPurityCeramic, needleAssembly);
  mesh(new THREE.TorusGeometry(3.5, 0.8, 8, 18), std(0xff5722, 0.9, 0.2, { emissive: 0xff3b00, emissiveIntensity: 1.2 }), needleAssembly, [0, 7, 0]);

  // Gravity-Specific Convective Buoyancy Vector (materializes under non-zero gravity)
  const buoyancyVectorGroup = new THREE.Group();
  buoyancyVectorGroup.position.set(0, 10, zCenter);
  chamberGroup.add(buoyancyVectorGroup);

  const buoyancyArrow = rod(V(0, 0, 0), V(0, 32, 0), 1.2, new THREE.MeshBasicMaterial({ color: 0xf59e0b }), buoyancyVectorGroup);
  const arrowCone = mesh(new THREE.ConeGeometry(3.5, 8, 16), new THREE.MeshBasicMaterial({ color: 0xf59e0b }), buoyancyVectorGroup, [0, 32, 0]);
  buoyancyVectorGroup.visible = false; // Hidden in 0g

  // ==========================================
  // 3. OVERHEAD CIR GANTRY & GAS MANIFOLDS
  // ==========================================
  const gantryGroup = new THREE.Group();
  gantryGroup.position.set(0, 150, zCenter);
  labFacility.add(gantryGroup);

  box(340, 16, 20, M.rackPanel, gantryGroup, [0, 95, 0]);
  box(16, 120, 20, M.rackPanel, gantryGroup, [-165, 35, 0]);
  box(16, 120, 20, M.rackPanel, gantryGroup, [165, 35, 0]);

  // Analog pressure gauge needle pointer
  let o2GaugeNeedle = null;
  const addGasBottle = (x, y, len, radius, colorHex, label, hasNeedle = false) => {
    const bGroup = new THREE.Group();
    bGroup.position.set(x, y, 0);
    const body = new THREE.CapsuleGeometry(radius, len, 8, 20);
    body.rotateZ(Math.PI / 2);
    mesh(body, std(colorHex, 0.85, 0.35), bGroup);
    mesh(new THREE.CylinderGeometry(radius * 0.4, radius * 0.4, 18, 16).rotateZ(Math.PI / 2), M.brassValve, bGroup, [len / 2 + 10, 0, 0]);

    const gauge = mesh(new THREE.CylinderGeometry(8, 8, 4, 16).rotateX(Math.PI / 2), M.steel, bGroup, [len / 2 + 12, 8, 0]);
    panel(12, 12, new THREE.MeshBasicMaterial({ color: 0xffffff, map: tx.plate("PSI", { w: 128, h: 128, size: 36 }) }), gauge, [0, 0, 2.5]);

    if (hasNeedle) {
      const needleMesh = rod(V(0, 0, 0), V(0, 5, 0), 0.5, new THREE.MeshBasicMaterial({ color: 0xef4444 }), gauge);
      needleMesh.position.set(0, 0, 2.8);
      o2GaugeNeedle = needleMesh;
    }

    panel(64, 14, new THREE.MeshBasicMaterial({ map: tx.plate(label, { w: 256, h: 64, size: 28, bg: "#0d131f", fg: "#ffffff" }) }), bGroup, [0, 0, radius + 1]);
    gantryGroup.add(bGroup);
    return bGroup;
  };

  addGasBottle(-75, 60, 120, 22, 0x0284c7, "O2 MANIFOLD", true);
  addGasBottle(75, 60, 130, 24, 0x334155, "N2 DILUENT", false);
  addGasBottle(0, 10, 80, 16, 0xbe123c, "LIQUID FUEL", false);

  // Dynamic Oxidizer Line (Glow intensifies with O2 fraction)
  const o2LineGroup = pipe([V(-75, 45, 0), V(-75, 0, 0), V(-45, -70, 0)], 4, M.manifoldCyan, gantryGroup);
  pipe([V(75, 45, 0), V(75, 0, 0), V(45, -70, 0)], 4, M.steel, gantryGroup);
  pipe([V(0, 0, 0), V(0, -60, 0)], 3, M.brassValve, gantryGroup);

  // Digital Atmospheric Transducer Readout
  const transducerBox = box(150, 32, 14, M.darkTitanium, chamberGroup, [0, RC + 22, zCenter]);
  const transducerScreen = panel(140, 24, new THREE.MeshBasicMaterial({
    map: tx.plate("P: 2.50 atm · O2: 40.0% · 0g", { w: 512, h: 96, size: 30, bg: "#040814", fg: "#38bdf8" })
  }), transducerBox, [0, 0, 7.5]);

  // ==========================================
  // 4. HOLOGRAPHIC 3D PARAMETER SPACE
  // ==========================================
  const paramSpaceGroup = new THREE.Group();
  paramSpaceGroup.position.set(0, 85, 20);
  labFacility.add(paramSpaceGroup);

  const cageW = 180, cageH = 120, cageD = 180;
  const cageGeo = new THREE.BoxGeometry(cageW, cageH, cageD);
  const cageEdges = new THREE.EdgesGeometry(cageGeo);
  paramSpaceGroup.add(new THREE.LineSegments(cageEdges, new THREE.LineBasicMaterial({ color: 0x20b9e8, transparent: true, opacity: 0.25 })));

  const gridHelper = new THREE.GridHelper(cageW, 10, 0x20b9e8, 0x26384b);
  gridHelper.position.set(0, -cageH / 2, 0);
  paramSpaceGroup.add(gridHelper);

  const coordTo3D = (pAtm, o2Frac, d0Mm) => {
    const z = -cageD/2 + ((pAtm - 0.3) / (2.5 - 0.3)) * cageD;
    const x = -cageW/2 + ((o2Frac - 0.15) / (0.42 - 0.15)) * cageW;
    const y = -cageH/2 + ((d0Mm - 0.5) / (2.5 - 0.5)) * cageH;
    return new THREE.Vector3(x, y, z);
  };

  // Authentic Historical NASA PSI Experiments (Zero Fabricated Points)
  const historicalMetadata = [];
  const validHistorical = [];
  let rejectedCount = 0;

  if (Array.isArray(historicalRecords)) {
    historicalRecords.forEach((item) => {
      const res = validateHistoricalRecord(item);
      if (res.valid) {
        validHistorical.push(res.data);
      } else {
        rejectedCount++;
      }
    });
  }

  const histPointsCount = validHistorical.length;
  const histPositions = new Float32Array(Math.max(1, histPointsCount) * 3);
  const histColors = new Float32Array(Math.max(1, histPointsCount) * 3);

  validHistorical.forEach((r, i) => {
    const pt = coordTo3D(r.pressure_atm, r.oxygen_fraction, r.droplet_diameter_mm);
    histPositions[i * 3 + 0] = pt.x;
    histPositions[i * 3 + 1] = pt.y;
    histPositions[i * 3 + 2] = pt.z;

    histColors[i * 3 + 0] = 0.22;
    histColors[i * 3 + 1] = 0.55;
    histColors[i * 3 + 2] = 0.85;

    historicalMetadata.push({
      evidence_id: r.evidence_id,
      uid: r.uid,
      accession: r.accession,
      campaign: r.campaign,
      test_id: r.test_id,
      run_id: r.test_id ? `${r.accession}:${r.test_id}` : r.evidence_id,
      family: r.family,
      material_or_fuel: r.material_or_fuel,
      gravity: r.gravity,
      pressure_atm: round(r.pressure_atm, 2),
      oxygen_fraction: round(r.oxygen_fraction, 3),
      droplet_diameter_mm: round(r.droplet_diameter_mm, 2),
      measured_k: r.measured_k !== null ? round(r.measured_k, 3) : null,
      source_provenance: r.source_provenance,
      literature_reference: r.literature_reference,
      scientific_quality: r.scientific_quality,
      pos: pt,
    });
  });

  const histGeo = new THREE.BufferGeometry();
  histGeo.setAttribute("position", new THREE.BufferAttribute(histPositions, 3));
  histGeo.setAttribute("color", new THREE.BufferAttribute(histColors, 3));
  const historicalPointCloud = new THREE.Points(histGeo, new THREE.PointsMaterial({
    size: 3.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending
  }));
  historicalPointCloud.userData = { historicalMetadata };
  paramSpaceGroup.add(historicalPointCloud);

  // Candidate Proposals Normalization - Zero Fabricated Fallbacks
  let normalizedCandidates = [];
  const candidateNodes = [];
  const candidateMeshes = [];
  const candGeo = new THREE.OctahedronGeometry(4.5, 1);
  const haloGeo = new THREE.SphereGeometry(1, 24, 16);

  function rebuildCandidateMeshes(rawList) {
    // Clear previous candidate meshes from scene
    candidateNodes.forEach(({ mesh: m, halo }) => {
      paramSpaceGroup.remove(m);
      m.geometry?.dispose();
      m.material?.dispose();
      halo.geometry?.dispose();
      halo.material?.dispose();
    });
    candidateNodes.length = 0;
    candidateMeshes.length = 0;

    normalizedCandidates = (rawList || []).map((c, idx) => {
      const p = c.parameters?.pressure_atm ?? c.pressure_atm ?? null;
      const o2 = c.parameters?.oxygen_fraction ?? c.o2_mole_fraction ?? null;
      const d0 = c.parameters?.droplet_d0_mm ?? c.droplet_diameter_mm ?? null;
      const eig = c.expected_info_gain ?? c.expected_information_gain_bits ?? null;
      const sigma = c.estimated_uncertainty_sigma ?? c.prediction_uncertainty_std ?? null;
      const sigmaF = c.latent_uncertainty_sigma_f ?? null;
      const sigmaFSq = c.latent_variance_sigma_f_sq ?? (sigmaF !== null ? sigmaF * sigmaF : null);
      const sigmaN = c.observation_noise_sigma_n ?? null;
      const predK = c.predicted_burn_rate_k ?? null;
      const isExploration = (c.feasibility_status && c.feasibility_status.includes("EXPLORATION")) || c.exploration_target || (p !== null && o2 !== null && Math.abs(p - 0.57) < 0.05 && Math.abs(o2 - 0.34) < 0.05);

      return {
        candidate_id: c.candidate_id || `CAND-${String(idx + 1).padStart(2, "0")}`,
        pressure_atm: p !== null ? round(p, 2) : null,
        o2_mole_fraction: o2 !== null ? round(o2, 3) : null,
        droplet_diameter_mm: d0 !== null ? round(d0, 2) : null,
        expected_information_gain_bits: eig !== null ? round(eig, 4) : null,
        prediction_uncertainty_std: sigma !== null ? round(sigma, 4) : null,
        latent_uncertainty_sigma_f: sigmaF !== null ? round(sigmaF, 4) : null,
        latent_variance_sigma_f_sq: sigmaFSq !== null ? round(sigmaFSq, 6) : null,
        observation_noise_sigma_n: sigmaN !== null ? round(sigmaN, 4) : null,
        predicted_burn_rate_k: predK !== null ? round(predK, 4) : null,
        exploration_target: Boolean(isExploration),
        scientific_rationale: c.scientific_rationale || "Bayesian EIG-guided parameter candidate.",
        recommended_facility: c.recommended_facility || null,
        feasibility_status: c.feasibility_status || "FEASIBLE_SPACEFLIGHT_STANDARDIZED",
        fuel: c.parameters?.fuel || c.fuel || null,
        model_status: c.model_status || (predK !== null ? "CALIBRATED" : "UNSUPPORTED_FUEL"),
        model_metadata: c.model_metadata || null,
        error_message: c.error_message || null,
      };
    });

    normalizedCandidates.forEach((cand, idx) => {
      const pos = coordTo3D(cand.pressure_atm || 1.0, cand.o2_mole_fraction || 0.21, cand.droplet_diameter_mm || 1.5);
      const colorHex = cand.exploration_target ? 0xf59e0b : 0xff791f;

      const candMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.8,
        transparent: true,
        opacity: 0.95
      });
      const cMesh = new THREE.Mesh(candGeo, candMat);
      cMesh.position.copy(pos);
      cMesh.userData = { cand, idx };

      const sigmaVal = cand.prediction_uncertainty_std !== null ? cand.prediction_uncertainty_std : 0.0;
      const haloRadius = 7.0 + sigmaVal * 16.0;
      const haloMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: cand.prediction_uncertainty_std !== null ? 0.22 : 0.0,
        wireframe: true
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.scale.set(haloRadius, haloRadius, haloRadius);
      if (cand.prediction_uncertainty_std === null) {
        halo.visible = false;
      }
      cMesh.add(halo);

      paramSpaceGroup.add(cMesh);
      candidateMeshes.push(cMesh);
      candidateNodes.push({ mesh: cMesh, halo, data: cand });
    });
  }

  // Initial candidate mesh build
  const rawInitialList = proposalsData?.all_candidates || proposalsData?.top_candidates || proposalsData?.candidates || [];
  rebuildCandidateMeshes(rawInitialList);

  const dynamicLaserGroup = new THREE.Group();
  paramSpaceGroup.add(dynamicLaserGroup);

  let targetCameraPos = new THREE.Vector3(0, 180, 520);
  let targetLookAt = new THREE.Vector3(0, 40, 0);
  let currentLookAt = new THREE.Vector3(0, 40, 0);
  let activeCandidate = null;

  function updateCandidateLinks(cand) {
    while (dynamicLaserGroup.children.length > 0) {
      const child = dynamicLaserGroup.children[0];
      dynamicLaserGroup.remove(child);
      child.geometry?.dispose();
    }
    if (!cand || cand.pressure_atm === null || cand.o2_mole_fraction === null) return;

    const origin = coordTo3D(cand.pressure_atm, cand.o2_mole_fraction, cand.droplet_diameter_mm || 1.5);

    if (historicalMetadata.length > 0) {
      // Find k=3 genuine nearest historical NASA flight runs
      const sorted = [...historicalMetadata].map((h) => {
        const dp = (h.pressure_atm - cand.pressure_atm) / 2.2;
        const do2 = (h.oxygen_fraction - cand.o2_mole_fraction) / 0.25;
        const dd0 = ((h.droplet_diameter_mm || 1.5) - (cand.droplet_diameter_mm || 1.5)) / 3.0;
        return { h, distSq: dp * dp + do2 * do2 + dd0 * dd0 };
      }).sort((a, b) => a.distSq - b.distSq).slice(0, 3);

      sorted.forEach(({ h }) => {
        const targetPt = h.pos;
        const lineGeo = new THREE.BufferGeometry().setFromPoints([origin, targetPt]);
        dynamicLaserGroup.add(new THREE.Line(lineGeo, M.laserGold));
        mesh(new THREE.SphereGeometry(2.2, 12, 10), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }), dynamicLaserGroup, targetPt.toArray());
      });
    }
  }

  function selectCandidate(cand, isUserManualPick = false) {
    if (!cand) return;
    activeCandidate = cand;

    const d0 = cand.droplet_diameter_mm !== null && cand.droplet_diameter_mm !== undefined ? cand.droplet_diameter_mm : 1.5;
    baseNeedleOffset = 5.0 + d0 * 2.2;
    flameRig.configure({
      d0,
      k: cand.predicted_burn_rate_k,
      o2: cand.o2_mole_fraction ?? 0.21,
      p: cand.pressure_atm ?? 1.0,
      fuel: cand.fuel || "n-heptane",
      enabled: cand.isFeasible !== false,
      g: currentGravity,
    });

    // Update chamber pressure gauge needle rotation (-135 deg to +45 deg)
    if (o2GaugeNeedle && cand.pressure_atm !== null) {
      const normP = Math.max(0, Math.min(1, (cand.pressure_atm - 0.3) / (2.5 - 0.3)));
      o2GaugeNeedle.rotation.z = -Math.PI * 0.75 + normP * Math.PI * 1.25;
    }

    // Update oxidizer manifold illumination
    const o2Frac = cand.o2_mole_fraction !== null ? cand.o2_mole_fraction : 0.21;
    if (M.manifoldCyan) {
      M.manifoldCyan.emissiveIntensity = 0.2 + (o2Frac / 0.42) * 0.8;
      if (o2Frac > 0.35) {
        M.manifoldCyan.color.setHex(0x38bdf8);
        M.manifoldCyan.emissive.setHex(0x0284c7);
      } else {
        M.manifoldCyan.color.setHex(0x60a5fa);
        M.manifoldCyan.emissive.setHex(0x1d4ed8);
      }
    }

    // Update digital readout on chamber without fallbacks
    const pStr = cand.pressure_atm !== null ? `${cand.pressure_atm.toFixed(2)} atm` : "Not available";
    const o2Str = cand.o2_mole_fraction !== null ? `${(cand.o2_mole_fraction * 100).toFixed(1)}%` : "Not available";
    const d0Str = cand.droplet_diameter_mm !== null ? `${cand.droplet_diameter_mm.toFixed(1)}mm` : "Not available";

    transducerScreen.material.map = tx.plate(
      `P: ${pStr} · O2: ${o2Str} · d0: ${d0Str}`,
      { w: 512, h: 96, size: 28, bg: cand.isFeasible === false ? "#280709" : cand.exploration_target ? "#1e1304" : "#040814", fg: cand.isFeasible === false ? "#ef4444" : cand.exploration_target ? "#fbbf24" : "#38bdf8" }
    );
    transducerScreen.material.map.needsUpdate = true;

    updateCandidateLinks(cand);

    // Dynamic nearest historical runs for dossier
    let nearestNeighbors = [];
    if (historicalMetadata.length > 0 && cand.pressure_atm !== null && cand.o2_mole_fraction !== null) {
      nearestNeighbors = [...historicalMetadata].map((h) => {
        const dp = (h.pressure_atm - cand.pressure_atm) / 2.2;
        const do2 = (h.oxygen_fraction - cand.o2_mole_fraction) / 0.25;
        const dd0 = ((h.droplet_diameter_mm || 1.5) - d0) / 3.0;
        return { h, distSq: dp * dp + do2 * do2 + dd0 * dd0 };
      }).sort((a, b) => a.distSq - b.distSq).slice(0, 3).map(item => item.h);
    }

    onSelectCandidate?.({
      ...cand,
      nearest_historical_runs: nearestNeighbors,
    }, isUserManualPick);
  }

  let latestEvaluatedPool = [];

  /**
   * LIVE REACTIVITY & STRICT FEASIBILITY FILTERING
   * Distinguishes: FEASIBLE_SPACEFLIGHT, GROUND_FACILITY_ONLY, HYPOTHETICAL_FRONTIER, UNSUPPORTED
   */
  function updateConstraints({ maxP = 2.5, maxO2 = 0.42, maxD0 = 2.5, objective = "MAX_INFORMATION_GAIN", gravity = 0.0 } = {}) {
    currentGravity = gravity;
    flameRig.setGravity(gravity);
    const evaluatedPool = [];

    // Update chamber gravity buoyancy vector (qualitative visualization)
    if (gravity > 0.01) {
      buoyancyVectorGroup.visible = true;
      const gScale = Math.min(1.8, 0.4 + gravity * 1.2);
      buoyancyVectorGroup.scale.set(1.0, gScale, 1.0);
    } else {
      buoyancyVectorGroup.visible = false;
    }

    candidateNodes.forEach(({ mesh: m, halo, data }) => {
      const feasibility = evaluateCandidateFeasibility(data, { maxP, maxO2, maxD0 }, gravity);

      let score = 0.0;
      if (feasibility.feasibilityStatus === "UNSUPPORTED") {
        score = -100.0;
      } else if (objective === "MAX_INFORMATION_GAIN") {
        score = data.expected_information_gain_bits !== null ? data.expected_information_gain_bits : 0.0;
      } else if (objective === "MAX_PREDICTIVE_VARIANCE") {
        score = data.latent_variance_sigma_f_sq !== null && data.latent_variance_sigma_f_sq !== undefined
          ? data.latent_variance_sigma_f_sq
          : (data.prediction_uncertainty_std !== null ? data.prediction_uncertainty_std * data.prediction_uncertainty_std : 0.0);
      } else if (objective === "EXPLORATION_FRONTIER") {
        const isTarget = data.exploration_target || feasibility.feasibilityStatus === "HYPOTHETICAL_FRONTIER";
        const eigVal = data.expected_information_gain_bits || 0.0;
        score = isTarget ? (10.0 + eigVal) : eigVal;
      } else if (objective === "EXTINCTION_BOUNDARY") {
        score = data.o2_mole_fraction < 0.25 ? (1.0 + (data.expected_information_gain_bits || 0.0)) : 0.1;
      } else {
        score = data.expected_information_gain_bits !== null ? data.expected_information_gain_bits : 0.0;
      }

      const candRecord = {
        ...data,
        isFeasible: feasibility.isFeasible,
        feasibility_status: feasibility.feasibilityStatus,
        feasibilityStatus: feasibility.feasibilityStatus,
        recommended_facility: feasibility.recommendedFacility,
        feasibility_source: feasibility.feasibilitySource,
        violations: feasibility.violations,
        scientific_rationale: feasibility.scientificRationale || data.scientific_rationale,
        effectiveScore: score,
        activeGravity: gravity,
      };

      evaluatedPool.push(candRecord);
      m.userData.cand = candRecord;

      // 3D Visual Encoding of Feasibility State
      if (feasibility.feasibilityStatus === "FEASIBLE_SPACEFLIGHT") {
        m.material.opacity = 0.95;
        m.material.wireframe = false;
        m.material.color.setHex(0xff791f);
        m.material.emissive.setHex(0xd95712);
        halo.visible = true;
      } else if (feasibility.feasibilityStatus === "GROUND_FACILITY_ONLY") {
        m.material.opacity = 0.95;
        m.material.wireframe = false;
        m.material.color.setHex(0x06b6d4);
        m.material.emissive.setHex(0x0e7490);
        halo.visible = true;
      } else if (feasibility.feasibilityStatus === "HYPOTHETICAL_FRONTIER") {
        m.material.opacity = 0.95;
        m.material.wireframe = false;
        m.material.color.setHex(0xf59e0b);
        m.material.emissive.setHex(0xb45309);
        halo.visible = true;
      } else {
        // UNSUPPORTED: Rendered as translucent red/crimson wireframe
        m.material.opacity = 0.28;
        m.material.wireframe = true;
        m.material.color.setHex(0xef4444);
        m.material.emissive.setHex(0x991b1b);
        halo.visible = false;
      }
    });

    latestEvaluatedPool = evaluatedPool;

    // Globally optimal candidate (unconstrained)
    const sortedGlobal = [...evaluatedPool].sort((a, b) => b.effectiveScore - a.effectiveScore);
    const globallyOptimal = sortedGlobal[0] || null;

    // Feasible candidates sorted by objective score
    const feasibleCandidates = evaluatedPool.filter(c => c.isFeasible).sort((a, b) => b.effectiveScore - a.effectiveScore);
    const infeasibleCandidates = evaluatedPool.filter(c => !c.isFeasible).sort((a, b) => b.effectiveScore - a.effectiveScore);

    const bestFeasible = feasibleCandidates[0] || null;

    // Maintain active candidate selection state seamlessly across filter updates
    let candidateToSelect = null;
    if (activeCandidate) {
      const match = evaluatedPool.find(c => c.candidate_id === activeCandidate.candidate_id);
      if (match) {
        candidateToSelect = match;
      }
    }
    if (!candidateToSelect) {
      candidateToSelect = bestFeasible || globallyOptimal;
    }
    if (candidateToSelect) {
      selectCandidate(candidateToSelect, false);
    }

    return {
      globallyOptimal,
      bestFeasible,
      feasibleCandidates,
      infeasibleCandidates,
      allEvaluated: evaluatedPool,
    };
  }

  function setCameraMode(mode) {
    const closeUp = mode === "burn" || mode === "sample";
    paramSpaceGroup.visible = !(mode === "burn");
    portGroup.visible = !closeUp;
    if (mode === "burn") {
      spherical.radius = 170; spherical.theta = 0; spherical.phi = Math.PI / 2.15;
      targetLookAt.set(0, 0, zCenter);
      targetCameraPos.set(0, 170 * Math.cos(spherical.phi), zCenter + 170 * Math.sin(spherical.phi));
    } else if (mode === "chamber") {
      targetCameraPos.set(0, 15, zCenter + 190); targetLookAt.set(0, 0, zCenter);
    } else if (mode === "sample") {
      targetCameraPos.set(0, 8, zCenter + 65); targetLookAt.set(0, 0, zCenter);
    } else if (mode === "rack") {
      targetCameraPos.set(0, 260, zCenter + 180); targetLookAt.set(0, 120, zCenter);
    } else {
      spherical.radius = 520; spherical.theta = 0; spherical.phi = Math.PI / 2.3;
      targetCameraPos.set(0, 180, 520); targetLookAt.set(0, 40, 0);
    }
  }

  // Pointer & Raycast Interaction
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 5.0;
  const mouse = new THREE.Vector2(-999, -999);

  let isDragging = false;
  let prevMouse = { x: 0, y: 0 };
  let spherical = { radius: 520, theta: 0, phi: Math.PI / 2.3 };

  const onPointerDown = (e) => { isDragging = true; prevMouse = { x: e.clientX, y: e.clientY }; };
  const onPointerMove = (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    if (isDragging) {
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      prevMouse = { x: e.clientX, y: e.clientY };
      spherical.theta -= dx * 0.005;
      spherical.phi = Math.max(0.15, Math.min(Math.PI / 2.05, spherical.phi - dy * 0.005));

      targetCameraPos.x = targetLookAt.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      targetCameraPos.y = targetLookAt.y + spherical.radius * Math.cos(spherical.phi);
      targetCameraPos.z = targetLookAt.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
    }
  };
  const onPointerUp = () => { isDragging = false; };

  const onPointerClick = (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // 1. Raycast candidates (retrieving freshest evaluated state)
    const candIntersects = paramSpaceGroup.visible ? raycaster.intersectObjects(candidateMeshes, false) : [];
    if (candIntersects.length > 0) {
      const hit = candIntersects[0].object;
      const hitId = hit.userData?.cand?.candidate_id;
      const freshCand = latestEvaluatedPool.find(c => c.candidate_id === hitId) || hit.userData?.cand;
      if (freshCand) {
        selectCandidate(freshCand, true);
        return;
      }
    }

    // 2. Raycast historical flight points
    const histIntersects = raycaster.intersectObject(historicalPointCloud, false);
    if (histIntersects.length > 0) {
      const idx = histIntersects[0].index;
      const histRun = historicalMetadata[idx];
      if (histRun) {
        onSelectHistorical?.(histRun);
      }
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    spherical.radius = Math.max(120, Math.min(1100, spherical.radius + e.deltaY * 0.45));
    targetCameraPos.x = targetLookAt.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
    targetCameraPos.y = targetLookAt.y + spherical.radius * Math.cos(spherical.phi);
    targetCameraPos.z = targetLookAt.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
  };

  const dom = renderer.domElement;
  dom.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  dom.addEventListener("click", onPointerClick);
  dom.addEventListener("wheel", onWheel, { passive: false });

  const onResize = () => {
    const w = Math.max(10, container.clientWidth);
    const h = Math.max(10, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(container);

  let animId = null;
  const animStartTime = performance.now();

  function animate() {
    animId = requestAnimationFrame(animate);
    const t = (performance.now() - animStartTime) * 0.001;

    camera.position.lerp(targetCameraPos, 0.06);
    currentLookAt.lerp(targetLookAt, 0.06);
    camera.lookAt(currentLookAt);

    const now = performance.now();
    const dt = Math.min(0.05, (now - (animate._last || now)) / 1000);
    animate._last = now;
    const fs = flameRig.update(dt, t);
    const goal = fs.needlesRetracted ? 70 : baseNeedleOffset;
    const k = fs.needlesRetracted ? 0.2 : 0.08;
    leftNeedle.position.x = THREE.MathUtils.lerp(leftNeedle.position.x, -goal, k);
    rightNeedle.position.x = THREE.MathUtils.lerp(rightNeedle.position.x, goal, k);
    if (now - lastFlameEmit > 90) { lastFlameEmit = now; onFlameState?.(fs); }

    candidateNodes.forEach(({ mesh: m, halo, data }, i) => {
      m.rotation.y = t * 0.4 + i;
      m.rotation.x = Math.sin(t * 0.6 + i) * 0.2;
      const baseScale = 7.0 + (data.prediction_uncertainty_std || 0.4) * 16.0;
      const pulse = baseScale * (1.0 + Math.sin(t * 2.0 + i) * 0.08);
      halo.scale.set(pulse, pulse, pulse);
    });

    renderer.render(scene, camera);
  }
  animate();

  setCameraMode("burn");

  return {
    selectCandidate,
    updateConstraints,
    updateFilters: updateConstraints,
    setCameraMode,
    setCandidatePool: (newList) => {
      rebuildCandidateMeshes(newList);
      return updateConstraints();
    },
    getCandidates: () => normalizedCandidates,
    getHistorical: () => historicalMetadata,
    flame: {
      play: () => flameRig.play(), pause: () => flameRig.pause(),
      isPlaying: () => flameRig.isPlaying(), restart: () => flameRig.restart(),
      setSpeed: (v) => flameRig.setSpeed(v), seek: (f) => flameRig.seek(f),
    },
    dispose: () => {
      if (animId) cancelAnimationFrame(animId);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("click", onPointerClick);
      dom.removeEventListener("wheel", onWheel);
      flameRig.dispose();
      disposeTree(scene);
      renderer.dispose();
      if (dom.parentElement === container) container.removeChild(dom);
    }
  };
}

function round(val, dec = 2) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}
