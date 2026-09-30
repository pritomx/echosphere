/* ==========================================================================
   EchoSphere — DEMO locations and SIMULATED prototype rules
   --------------------------------------------------------------------------
   EVERYTHING IN THIS FILE IS ILLUSTRATIVE.
   - Demo locations are labelled "DEMO". Their dates, fields and values are
     synthetic scenarios generated below. They are NOT NASA or NISAR observations.
   - Rainfall values and risk rules are labelled "SIMULATED". They are not
     connected to GPM IMERG or to any disaster-management system.
   When real NISAR records (data/manifest.js) fall inside a demo location's
   bounding box, app.js automatically uses the real records instead.
   ========================================================================== */

/* Deterministic pseudo-random numbers, so every visitor sees the same demo. */
function demoRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Smooth value noise on a coarse lattice (for terrain-like variation). */
function demoSmoothNoise(w, h, cell, seed) {
  const rnd = demoRng(seed);
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const lattice = new Float32Array(gw * gh).map(() => rnd());
  const out = new Float32Array(w * h);
  const fade = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / cell, gy = y / cell;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = fade(gx - x0), fy = fade(gy - y0);
      const a = lattice[y0 * gw + x0], b = lattice[y0 * gw + x0 + 1];
      const c = lattice[(y0 + 1) * gw + x0], d = lattice[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    }
  }
  return out;
}

const DEMO_GRID = { w: 180, h: 140 };

/* Synthetic "backscatter-like" fields in illustrative dB (DEMO). */
const DEMO_GENERATORS = {
  /* Braided river whose channels widen and whose low chars flood as the monsoon progresses. */
  river(i, p) {
    const { w, h } = DEMO_GRID;
    const terrain = demoSmoothNoise(w, h, 18, 11);
    const speck = demoRng(100 + i);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const v = y / h;
      const cx = 0.5 + 0.09 * Math.sin(v * 6.5 + 0.4) + 0.035 * Math.sin(v * 19) - 0.02 * i * v;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const dist = Math.abs(u - cx);
        const channel = dist < 0.035 + 0.05 * p.level;
        const side = Math.abs(u - (cx + 0.07 * Math.sin(v * 11))) < 0.012 + 0.015 * p.level;
        const lowland = terrain[y * w + x] < 0.18 + 0.32 * p.level && dist < 0.25;
        const water = channel || side || lowland;
        const base = water ? -21 : -7.5 + (terrain[y * w + x] - 0.5) * 4;
        out[y * w + x] = base + (speck() - 0.5) * 3.2;
      }
    }
    return out;
  },
  /* Vegetated hills; a burn scar appears after the illustrative fire and partly recovers. */
  burn(i, p) {
    const { w, h } = DEMO_GRID;
    const terrain = demoSmoothNoise(w, h, 14, 23);
    const edge = demoSmoothNoise(w, h, 7, 29);
    const speck = demoRng(200 + i);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x / w - 0.52) / 0.3, dy = (y / h - 0.48) / 0.22;
        const inScar = dx * dx + dy * dy + (edge[y * w + x] - 0.5) * 0.9 < 1;
        let val = -8.5 + (terrain[y * w + x] - 0.5) * 5;
        if (inScar) val -= p.burn * 5.5;
        if (x / w > 0.9) val = -23; // coastline / reservoir edge
        out[y * w + x] = val + (speck() - 0.5) * 3;
      }
    }
    return out;
  },
  /* Glacier tongue with a retreating terminus into a proglacial lake. */
  glacier(i, p) {
    const { w, h } = DEMO_GRID;
    const terrain = demoSmoothNoise(w, h, 16, 37);
    const speck = demoRng(300 + i);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / h;
        const cy = 0.5 + 0.08 * Math.sin(u * 5);
        const halfWidth = 0.16 - 0.08 * u;
        const onGlacier = Math.abs(v - cy) < halfWidth && u < p.terminus;
        const lake = Math.abs(v - cy) < halfWidth + 0.05 && u >= p.terminus && u < 0.9;
        let val = -5.5 + (terrain[y * w + x] - 0.5) * 6;       // rock / moraine
        if (onGlacier) val = -12 + (terrain[y * w + x] - 0.5) * 2;
        if (lake || u >= 0.9) val = -23;
        out[y * w + x] = val + (speck() - 0.5) * 3;
      }
    }
    return out;
  },
  /* Relative, UNITLESS motion field on the glacier tongue (DEMO — not a physical measurement). */
  glacierMotion(i, p) {
    const { w, h } = DEMO_GRID;
    const out = new Float32Array(w * h).fill(NaN);
    const n = demoSmoothNoise(w, h, 10, 41 + i);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / h;
        const cy = 0.5 + 0.08 * Math.sin(u * 5);
        const halfWidth = 0.16 - 0.08 * u;
        const across = Math.abs(v - cy) / halfWidth;
        if (across < 1 && u < p.terminus) {
          out[y * w + x] = Math.max(0, (1 - across * across) * (0.25 + 0.75 * u / p.terminus) * p.speed + (n[y * w + x] - 0.5) * 0.08);
        }
      }
    }
    return out;
  },
  /* Marsh fragmenting into open water. */
  wetland(i, p) {
    const { w, h } = DEMO_GRID;
    const terrain = demoSmoothNoise(w, h, 9, 53);
    const coarse = demoSmoothNoise(w, h, 30, 59);
    const speck = demoRng(400 + i);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        const gulf = y / h > 0.82 - 0.1 * Math.sin(x / w * 4);
        const water = gulf || (terrain[k] * 0.6 + coarse[k] * 0.4) < 0.22 + p.loss;
        const val = water ? -22 : -10 + (terrain[k] - 0.5) * 3;
        out[y * w + x] = val + (speck() - 0.5) * 3;
      }
    }
    return out;
  },
};

/* --------------------------------------------------------------------------
   DEMO locations. Dates are illustrative scenario dates, NOT acquisitions.
   -------------------------------------------------------------------------- */
const DEMO_LOCATIONS = [
  {
    key: "bangladesh",
    provenance: "DEMO",
    name: "Jamuna River",
    region: "BANGLADESH",
    phenomenon: "River erosion / flooding",
    description: "Braided channels of the Jamuna (Brahmaputra) with low-lying char islands that flood during the monsoon.",
    bounds: [[24.25, 89.45], [24.85, 89.95]],
    productLabel: "GCOV-style backscatter (DEMO)",
    layers: ["flood", "change"],
    generator: "river",
    riskEnabled: true,
    observations: [
      { date: "2026-05-02", params: { level: 0.05 }, simRainfallMm: 22 },
      { date: "2026-05-14", params: { level: 0.12 }, simRainfallMm: 48 },
      { date: "2026-05-26", params: { level: 0.3 },  simRainfallMm: 76 },
      { date: "2026-06-07", params: { level: 0.62 }, simRainfallMm: 131 },
      { date: "2026-06-19", params: { level: 0.85 }, simRainfallMm: 164 },
      { date: "2026-07-01", params: { level: 0.6 },  simRainfallMm: 88 },
    ],
  },
  {
    key: "california",
    provenance: "DEMO",
    name: "Sierra Nevada foothills",
    region: "CALIFORNIA",
    phenomenon: "Wildfire burn scar",
    description: "Vegetated terrain where loss of canopy after a fire changes the radar return.",
    bounds: [[38.55, -121.25], [39.05, -120.6]],
    productLabel: "GCOV-style backscatter (DEMO)",
    layers: ["change", "flood"],
    generator: "burn",
    observations: [
      { date: "2026-07-10", params: { burn: 0 } },
      { date: "2026-07-22", params: { burn: 0 } },
      { date: "2026-08-03", params: { burn: 0.9 } },
      { date: "2026-08-15", params: { burn: 1 } },
      { date: "2026-08-27", params: { burn: 0.85 } },
    ],
  },
  {
    key: "alaska",
    provenance: "DEMO",
    name: "Coastal outlet glacier",
    region: "ALASKA",
    phenomenon: "Glacier retreat and flow",
    description: "A tidewater-style glacier tongue whose terminus retreats into a growing proglacial lake.",
    bounds: [[60.85, -148.2], [61.2, -147.4]],
    productLabel: "GCOV / GOFF-style (DEMO)",
    layers: ["motion", "change", "flood"],
    generator: "glacier",
    motionGenerator: "glacierMotion",
    observations: [
      { date: "2026-04-05", params: { terminus: 0.74, speed: 0.55 } },
      { date: "2026-04-17", params: { terminus: 0.72, speed: 0.62 } },
      { date: "2026-04-29", params: { terminus: 0.7, speed: 0.7 } },
      { date: "2026-05-11", params: { terminus: 0.67, speed: 0.82 } },
      { date: "2026-05-23", params: { terminus: 0.64, speed: 1 } },
    ],
  },
  {
    key: "louisiana",
    provenance: "DEMO",
    name: "Barataria Basin",
    region: "LOUISIANA",
    phenomenon: "Coastal wetland loss",
    description: "Marsh platform fragmenting into open water along the Gulf coast.",
    bounds: [[29.3, -90.3], [29.75, -89.75]],
    productLabel: "GCOV-style backscatter (DEMO)",
    layers: ["flood", "change"],
    generator: "wetland",
    observations: [
      { date: "2026-03-01", params: { loss: 0.0 } },
      { date: "2026-03-13", params: { loss: 0.03 } },
      { date: "2026-03-25", params: { loss: 0.05 } },
      { date: "2026-04-06", params: { loss: 0.08 } },
      { date: "2026-04-18", params: { loss: 0.11 } },
    ],
  },
];

/* --------------------------------------------------------------------------
   SIMULATED prototype rule engine (Bangladesh concept only).
   These thresholds are NOT validated disaster-management thresholds.
   -------------------------------------------------------------------------- */
const RISK_RULES = {
  provenance: "SIMULATED",
  waterHighPct: 20,      // X  — relative rise of NISAR open-water area (%)
  waterMediumPct: 10,
  rainHighMm: 100,       // Y  — supporting 72-hour rainfall (mm), SIMULATED context
  rainMediumMinMm: 50,   // Y1
  rainMediumMaxMm: 100,  // Y2
  evaluate(waterIncreasePct, rainfallMm) {
    const r = this;
    if (waterIncreasePct == null || rainfallMm == null || !isFinite(waterIncreasePct) || !isFinite(rainfallMm)) {
      return { level: null, rule: "Not available — the inputs for the rule are missing." };
    }
    if (waterIncreasePct > r.waterHighPct && rainfallMm > r.rainHighMm) {
      return { level: "HIGH", ruleIndex: 0, rule: `IF NISAR open-water area rose more than ${r.waterHighPct}%\nAND supporting rainfall > ${r.rainHighMm} mm\nTHEN risk = HIGH` };
    }
    if (waterIncreasePct > r.waterMediumPct && rainfallMm >= r.rainMediumMinMm) {
      return { level: "MEDIUM", ruleIndex: 1, rule: `IF water increase > ${r.waterMediumPct}%\nAND rainfall ≥ ${r.rainMediumMinMm} mm (typically ${r.rainMediumMinMm}–${r.rainMediumMaxMm} mm)\nTHEN risk = MEDIUM` };
    }
    return { level: "LOW", ruleIndex: 2, rule: "OTHERWISE\nTHEN risk = LOW" };
  },
};

const SIMULATED_SMS_BN = "সতর্কতা: যমুনার চরে আগামী ২৪ ঘণ্টায় বন্যার ঝুঁকি বেশি। নিরাপদ স্থানে যান।";
