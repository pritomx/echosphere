/* ==========================================================================
   EchoSphere application script (plain JavaScript, works from file://)
   One normalised model = NISAR_MANIFEST (REAL NISAR) + DEMO_LOCATIONS (DEMO)
   + current selection. Every panel renders from that model.
   ========================================================================== */
(function () {
  "use strict";

  const NA = "Not available";
  const P = { REAL: "REAL NISAR", DEMO: "DEMO", SIM: "SIMULATED" };
  const DEFAULT_THRESHOLD = -18;
  const CHANGE_DB = 3;
  const HIST_EDGES = Array.from({ length: 31 }, (_, i) => i - 15);
  const WATER_CURVE = Array.from({ length: 17 }, (_, i) => i - 26);
  const LAYER_NAMES = { flood: "Flood / Open Water", change: "Surface Change", motion: "Deformation / Motion" };
  const COL = { cy: "#6ec3d4", mg: "#e58fb4", acc: "#d4b483", gr: "#86c9a0", rd: "#e07a6a", bl: "#5b8fd1", mu: "#a09f98", fa: "#6c6b66", vi: "#b9a3e6" };

  /* ---------------------------------------------------------------- utils */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const minus = (s) => String(s).replace(/^-/, "−");
  const fmt = (v, d = 1, unit = "") => (isNum(v) ? minus(v.toFixed(d)) + unit : NA);
  const signed = (v, d = 2, unit = "") => (isNum(v) ? (v > 0 ? "+" : "") + minus(v.toFixed(d)) + unit : NA);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

  function tag(prov, large) {
    const sim = prov === P.SIM, sample = prov === P.DEMO;
    const cls = sim ? "tag-sim" : sample ? "tag-demo" : "tag-real";
    return `<span class="tag ${cls}${large ? " tag-lg" : ""}">${sim ? "SIMULATED" : sample ? "SAMPLE" : "CURRENT"}</span>`;
  }
  const manifest = () => (typeof NISAR_MANIFEST !== "undefined" && Array.isArray(NISAR_MANIFEST) ? NISAR_MANIFEST : []);
  const na = (msg) => `<p class="na">${esc(msg || NA)}</p>`;

  /* --------------------------------------------------------- shell */
  function initShell() {
    const btn = $(".nav-toggle"), links = $("#nav-links");
    if (btn && links) {
      btn.addEventListener("click", () => {
        const open = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", String(open));
        btn.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
        links.classList.toggle("open", open);
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && links.classList.contains("open")) { btn.click(); btn.focus(); } });
    }
    const mode = $("#sys-mode");
    if (mode) {
      const n = manifest().length;
      mode.innerHTML = `<span class="dot${n ? " real" : ""}"></span>MANIFEST <b>${n}</b> REC · MODE <b>${n ? "CURRENT" : "SAMPLE"}</b>`;
    }
    const clock = $("#sys-clock");
    if (clock) {
      const tick = () => { clock.textContent = new Date().toISOString().slice(11, 19); };
      tick();
      setInterval(tick, 1000);
    }
  }
  /* --------------------------------------------------------- tabs (any page) */
  function initTabs() {
    $$(".tabbar").forEach((bar) => {
      const key = `es.tab.${bar.dataset.tabs || document.body.dataset.page}`;
      const panes = $$(".tabpane");
      const show = (name) => {
        $$("button[data-tab]", bar).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
        panes.forEach((p) => { p.hidden = p.dataset.pane !== name; });
        try { sessionStorage.setItem(key, name); } catch (err) { /* per-viewer convenience only */ }
        document.dispatchEvent(new CustomEvent("es:tab", { detail: { tab: name } }));
      };
      $$("button[data-tab]", bar).forEach((b) => {
        b.addEventListener("click", () => show(b.dataset.tab));
        b.addEventListener("keydown", (e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const all = $$("button[data-tab]", bar), i = all.indexOf(b), n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
          n.focus(); n.click();
        });
      });
      let start = (location.hash || "").slice(1);
      try { start = start || sessionStorage.getItem(key) || ""; } catch (err) { /* ignore */ }
      if (!$(`button[data-tab="${start}"]`, bar)) start = $("button[data-tab]", bar).dataset.tab;
      show(start);
      window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if ($(`button[data-tab="${h}"]`, bar)) show(h); });
    });
  }

  /* --------------------------------------------------------- API connection menu (top bar) */
  const API_SOURCES = [
    { name: "NASA CMR", what: "NISAR granule catalog", kind: "json", url: "https://cmr.earthdata.nasa.gov/search/collections.json?short_name=NISAR_L2_GCOV_PROVISIONAL_V1&page_size=1" },
    { name: "NASA GIBS", what: "NISAR · IMERG · OPERA tiles", kind: "img", url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/2026-09-20/GoogleMapsCompatible_Level6/0/0/0.png" },
    { name: "NASA POWER", what: "daily precipitation / temperature", kind: "json", url: "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M&community=AG&longitude=89.7&latitude=24.55&start=20260901&end=20260902&format=JSON" },
    { name: "ASF Search", what: "NISAR product search", kind: "json", url: "https://api.daac.asf.alaska.edu/services/search/param?platform=NISAR&maxResults=1&output=geojson" },
    { name: "Open-Meteo", what: "16-day weather forecast", kind: "json", url: "https://api.open-meteo.com/v1/forecast?latitude=24.55&longitude=89.7&daily=precipitation_sum&forecast_days=1" },
  ];
  const apiState = API_SOURCES.map(() => ({ status: "…", ms: null, ok: null, hist: [] }));
  function pingSource(src) {
    const t0 = performance.now();
    if (src.kind === "img") {
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => res({ ok: true, status: "200 image", ms: Math.round(performance.now() - t0) });
        img.onerror = () => res({ ok: false, status: "unreachable", ms: Math.round(performance.now() - t0) });
        img.src = `${src.url}?t=${Date.now()}`;
      });
    }
    return fetch(src.url, { cache: "no-store" })
      .then((r) => r.text().then(() => ({ ok: r.ok, status: `${r.status}`, ms: Math.round(performance.now() - t0) })))
      .catch((err) => ({ ok: false, status: err.name === "TypeError" ? "network / CORS" : err.message, ms: Math.round(performance.now() - t0) }));
  }
  function renderApiMenu() {
    const m = $("#api-menu");
    if (!m) return;
    const ok = apiState.filter((s) => s.ok).length, done = apiState.filter((s) => s.ok !== null).length;
    const dot = $("#api-dot");
    dot.className = "apidot" + (done < API_SOURCES.length ? "" : ok === API_SOURCES.length ? " ok" : ok ? " warn" : " err");
    dot.title = `${ok}/${API_SOURCES.length} live APIs reachable`;
    m.innerHTML = `<div class="pn-h">Connected APIs<span class="r fa">${ok}/${API_SOURCES.length} online · keyless · read-only</span></div>
      <table class="data"><thead><tr><th>Source</th><th>Provides</th><th>Status</th><th class="num">ms</th><th>Trend</th></tr></thead><tbody>${API_SOURCES.map((s, i) => {
        const st = apiState[i];
        return `<tr><td><span class="apidot ${st.ok === null ? "" : st.ok ? "ok" : "err"}"></span> ${esc(s.name)}</td><td class="fa">${esc(s.what)}</td><td class="${st.ok ? "status-ok" : st.ok === false ? "status-err" : ""}">${esc(st.status)}</td><td class="num">${st.ms ?? "—"}</td><td><span class="spark-inline">${sparkline(st.hist, st.ok ? COL.gr : COL.rd)}</span></td></tr>`;
      }).join("")}</tbody></table>
      <div class="pn-b">
        <label for="api-url">Test any endpoint</label>
        <div class="row" style="flex-wrap:nowrap"><input type="url" id="api-url" placeholder="https://…" spellcheck="false"><button class="btn btn-sm pri" id="api-test" type="button">Test</button><button class="btn btn-sm" id="api-recheck" type="button">↻ Re-check</button></div>
        <pre class="resp" id="api-out" style="max-height:160px;margin-top:6px" hidden></pre>
      </div>`;
    $("#api-recheck").addEventListener("click", pingAll);
    const run = async () => {
      const url = $("#api-url").value.trim(), out = $("#api-out");
      out.hidden = false;
      if (!/^https?:\/\//i.test(url)) { out.textContent = "Enter a full http(s):// URL."; return; }
      out.textContent = "…";
      const t0 = performance.now();
      try {
        const r = await fetch(url);
        const body = await r.text();
        out.textContent = `${r.status} ${r.statusText} · ${Math.round(performance.now() - t0)} ms · ${(new Blob([body]).size / 1024).toFixed(1)} KB · ${r.headers.get("content-type") || ""}\n\n${body.slice(0, 1200)}`;
      } catch (err) { out.textContent = `Failed: ${err.message}\n(no internet, or the server does not allow cross-origin requests)`; }
    };
    $("#api-test").addEventListener("click", run);
    $("#api-url").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  }
  async function pingAll() {
    await Promise.all(API_SOURCES.map(async (s, i) => {
      const r = await pingSource(s);
      Object.assign(apiState[i], r);
      apiState[i].hist.push(r.ok ? r.ms : null);
      apiState[i].hist = apiState[i].hist.slice(-20);
    }));
    if (!$("#api-menu").hidden) {
      const url = $("#api-url") ? $("#api-url").value : "";
      renderApiMenu();
      if (url) $("#api-url").value = url;
    } else renderApiMenu();
  }
  function initApiMenu() {
    const btn = $("#api-btn"), menu = $("#api-menu");
    if (!btn || !menu) return;
    renderApiMenu();
    btn.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      if (open) pingAll();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); } });
    document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
    pingAll();
  }

  function dataStatusText() {
    const m = manifest();
    if (!m.length) return "No processed NISAR files found. Showing sample data.";
    return `${m.length} NISAR scenes processed · updated every 12-day pass`;
  }

  /* ======================================================================
     DATA MODEL
     ====================================================================== */
  function bboxAreaKm2(b) {
    const R = 6371.0088, rad = Math.PI / 180;
    return R * R * Math.abs((b[1][1] - b[0][1]) * rad) * Math.abs(Math.sin(b[1][0] * rad) - Math.sin(b[0][0] * rad));
  }
  /* Decode the quantised grid that process_nisar.py embeds (255 = no data). */
  function decodeGrid(g) {
    const bin = atob(g.b64);
    const values = new Float32Array(g.w * g.h);
    for (let i = 0; i < values.length; i++) {
      const q = bin.charCodeAt(i);
      values[i] = q === g.nodata ? NaN : g.min + (q / 254) * (g.max - g.min);
    }
    return { w: g.w, h: g.h, values, mercator: true };
  }
  function getGrid(o) {
    if (o._grid === undefined) o._grid = o.gridRaw ? decodeGrid(o.gridRaw) : o.grid || null;
    return o._grid;
  }
  function motionGrid(o) {
    if (o._mgrid === undefined) o._mgrid = o.motionRaw ? decodeGrid(o.motionRaw) : o.motionGrid || null;
    return o._mgrid;
  }
  function summarize(values, thr) {
    let n = 0, sum = 0, water = 0, min = Infinity, max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      n++; sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
      if (thr != null && v < thr) water++;
    }
    return n ? { n, mean: sum / n, min, max, waterPct: (100 * water) / n } : { n: 0, mean: null, min: null, max: null, waterPct: null };
  }
  function diffStats(a, b, pxArea) {
    const counts = new Array(HIST_EDGES.length - 1).fill(0);
    let n = 0, sum = 0, changed = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      if (!Number.isFinite(d)) continue;
      n++; sum += d;
      if (Math.abs(d) >= CHANGE_DB) changed++;
      counts[clamp(Math.floor(d - HIST_EDGES[0]), 0, counts.length - 1)]++;
    }
    if (!n) return null;
    return { meanChangeDb: sum / n, percentChanged: (100 * changed) / n, changedAreaKm2: changed * pxArea, changeThresholdDb: CHANGE_DB, histogram: { edgesDb: HIST_EDGES, counts } };
  }
  function quantiles(values) {
    const f = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
    if (!f.length) return null;
    const q = (p) => f[Math.min(f.length - 1, Math.floor(p * (f.length - 1)))];
    return [q(0.02), q(0.25), q(0.5), q(0.75), q(0.98)];
  }

  /* DEMO: synthesise fields, then compute statistics with the same rules as process_nisar.py. */
  function buildDemoLocation(def) {
    const { w, h } = DEMO_GRID;
    const pxArea = bboxAreaKm2(def.bounds) / (w * h);
    const obs = def.observations.map((o, i) => {
      const values = DEMO_GENERATORS[def.generator](i, o.params);
      const motion = def.motionGenerator ? DEMO_GENERATORS[def.motionGenerator](i, o.params) : null;
      const s = summarize(values, DEFAULT_THRESHOLD);
      const stats = { meanBackscatterDb: s.mean, analyzedAreaKm2: s.n * pxArea, waterCurve: { thresholdsDb: WATER_CURVE, percent: WATER_CURVE.map((t) => summarize(values, t).waterPct) } };
      if (motion) {
        const m = summarize(motion, null);
        Object.assign(stats, { minDisplacement: m.min, maxDisplacement: m.max, meanDisplacement: m.mean, displacementUnits: "relative units (unitless)", legendRange: [0, 1] });
      }
      return {
        id: `${def.key}-demo-${i + 1}`, provenance: P.DEMO, date: o.date, datetime: null,
        product: "DEMO", productLabel: def.productLabel, granule: null, maturity: null, bounds: def.bounds,
        kinds: motion ? ["backscatter", "motion"] : ["backscatter"],
        grid: { w, h, values, mercator: false }, motionGrid: motion ? { w, h, values: motion, mercator: false } : null,
        motionKind: "Illustrative relative motion (DEMO, unitless)", overlays: {}, stats, pxArea,
        simRainfallMm: o.simRainfallMm ?? null, processing: null,
      };
    });
    obs.forEach((o, i) => {
      if (!i) return;
      const prev = obs[i - 1];
      const d = diffStats(o.grid.values, prev.grid.values, o.pxArea);
      if (d) Object.assign(o.stats, d, { intervalDays: daysBetween(prev.date, o.date) });
      o.previousId = prev.id;
    });
    return { key: def.key, provenance: P.DEMO, name: def.name, region: def.region, phenomenon: def.phenomenon, description: def.description, bounds: def.bounds, productLabel: def.productLabel, layers: def.layers, riskEnabled: !!def.riskEnabled, observations: obs };
  }
  /* REAL: normalise a manifest record without changing any of its values. */
  function normalizeReal(r) {
    const isMotion = r.product === "GUNW" || r.product === "GOFF";
    return {
      id: r.id, provenance: P.REAL, date: r.date, datetime: r.datetime, dateSource: r.dateSource,
      product: r.product, productLabel: `${r.product}${r.band ? " · " + r.band : ""}${r.polarization ? " · " + r.polarization : ""}`,
      granule: r.granule, granuleSource: r.granuleSource, maturity: r.maturity, maturitySource: r.maturitySource,
      bounds: r.bounds, kinds: isMotion ? ["motion"] : ["backscatter"],
      gridRaw: isMotion ? null : r.grid, motionRaw: isMotion ? r.grid : null, motionKind: r.motionKind,
      overlays: { backscatter: r.overlay, water: r.waterOverlay, change: r.changeOverlay, motion: r.motionOverlay },
      stats: r.stats || {}, processing: r.processing, sourceFile: r.sourceFile, previousId: r.previousId,
      referenceDatetime: r.referenceDatetime, secondaryDatetime: r.secondaryDatetime, units: r.units, name: r.name, simRainfallMm: null,
    };
  }
  function deriveLayers(obs) {
    const nB = obs.filter((o) => o.kinds.includes("backscatter")).length;
    const layers = [];
    if (nB) layers.push("flood");
    if (nB >= 2) layers.push("change");
    if (obs.some((o) => o.kinds.includes("motion"))) layers.push("motion");
    return layers;
  }
  function centerInside(inner, outer) {
    const lat = (inner[0][0] + inner[1][0]) / 2, lon = (inner[0][1] + inner[1][1]) / 2;
    return lat >= outer[0][0] && lat <= outer[1][0] && lon >= outer[0][1] && lon <= outer[1][1];
  }
  function buildLocations() {
    const demos = DEMO_LOCATIONS.map(buildDemoLocation);
    const sites = {};
    manifest().forEach((r) => (sites[r.site] = sites[r.site] || []).push(normalizeReal(r)));
    const realLocs = Object.entries(sites).map(([site, obs]) => {
      obs.sort((a, b) => Date.parse(a.datetime || a.date) - Date.parse(b.datetime || b.date));
      const b = [[Math.min(...obs.map((o) => o.bounds[0][0])), Math.min(...obs.map((o) => o.bounds[0][1]))], [Math.max(...obs.map((o) => o.bounds[1][0])), Math.max(...obs.map((o) => o.bounds[1][1]))]];
      return { key: site, provenance: P.REAL, name: obs[0].name || site, region: "NISAR SITE", phenomenon: "Surface change observed by NISAR", description: `Area covered by ${obs.length} processed NISAR file(s).`, bounds: b, productLabel: [...new Set(obs.map((o) => o.product))].join(" + "), layers: deriveLayers(obs), riskEnabled: false, observations: obs };
    });
    // A real site whose centre lies inside a demo location replaces that demo automatically.
    const used = new Set();
    const out = demos.map((d) => {
      const match = realLocs.filter((r) => !used.has(r.key) && centerInside(r.bounds, d.bounds)).sort((a, b) => b.observations.length - a.observations.length)[0];
      if (!match) return d;
      used.add(match.key);
      return Object.assign({}, match, { key: d.key, name: d.name, region: d.region, phenomenon: d.phenomenon, riskEnabled: d.riskEnabled, replacedDemo: true, realSite: match.key });
    });
    // name processed sites after the example areas they belong to
    const ex = (window.ESArea && window.ESArea.examples) || [];
    realLocs.filter((r) => !used.has(r.key)).forEach((r) => {
      const m = ex.find((x) => centerInside(r.bounds, [[x.bbox[1], x.bbox[0]], [x.bbox[3], x.bbox[2]]]));
      if (m) Object.assign(r, { key: m.site, name: m.name, region: m.place.toUpperCase(), phenomenon: m.phenomenon });
      out.push(r);
    });
    // once real processed data exists, the synthetic fallback scenarios are not shown
    return out.some((l) => l.provenance === P.REAL) ? out.filter((l) => l.provenance === P.REAL) : out;
  }
  const seriesFor = (loc, layer) => loc.observations.filter((o) => o.kinds.includes(layer === "motion" ? "motion" : "backscatter"));
  /* Open-water % at a threshold: full-resolution curve when available, else the grid. */
  function waterPct(o, thr) {
    if (!o || !o.kinds.includes("backscatter")) return null;
    const c = o.stats.waterCurve;
    if (c && c.thresholdsDb) {
      const k = c.thresholdsDb.indexOf(thr);
      if (k >= 0 && isNum(c.percent[k])) return c.percent[k];
    }
    const g = getGrid(o);
    return g ? summarize(g.values, thr).waterPct : null;
  }
  const waterKm2 = (o, thr) => { const p = waterPct(o, thr); return isNum(p) && isNum(o.stats.analyzedAreaKm2) ? (p / 100) * o.stats.analyzedAreaKm2 : null; };
  const meanMotion = (o) => (isNum(o.stats.meanDisplacement) ? o.stats.meanDisplacement : o.stats.meanPhase);

  /* ======================================================================
     PLOTTING KIT (SVG strings, no library)
     ====================================================================== */
  const STOPS = {
    gray: [[0, [8, 12, 20]], [1, [235, 240, 250]]],
    div: [[0, [33, 102, 172]], [0.5, [245, 245, 245]], [1, [178, 24, 43]]],
    mag: [[0, [13, 8, 135]], [0.5, [204, 71, 120]], [1, [240, 249, 33]]],
    dens: [[0, [17, 20, 24]], [0.25, [30, 70, 110]], [0.6, [53, 182, 214]], [1, [240, 240, 200]]],
  };
  function color(t, stops) {
    t = clamp(t, 0, 1);
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [p0, c0] = stops[i - 1], [p1, c1] = stops[i];
        const f = (t - p0) / (p1 - p0 || 1);
        return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f));
      }
    }
    return stops[stops.length - 1][1];
  }
  function niceTicks(lo, hi, n = 4) {
    const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= n + 1);
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function frame({ W, H, m, x0, x1, y0, y1, xTicks, xFmt, yFmt, xLabel, yLabel, title, prov }) {
    const X = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
    const yt = niceTicks(y0, y1, 4).filter((v) => v >= y0 && v <= y1);
    const xt = xTicks || niceTicks(x0, x1, 5).filter((v) => v >= x0 && v <= x1);
    let s = "";
    if (title) s += `<text class="ttl" x="${m.l}" y="12">${esc(title)}</text>`;
    if (prov) s += `<text x="${W - m.r}" y="12" text-anchor="end" style="fill:${prov === P.DEMO ? "var(--demo)" : prov === P.REAL ? "var(--real)" : prov === P.SIM ? "var(--sim)" : "var(--mu)"};font-weight:600">${prov === P.DEMO ? "DEMO DATA" : esc(prov)}</text>`;
    s += yt.map((v) => `<line class="gd" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 4}" y="${Y(v) + 3}" text-anchor="end">${minus((yFmt || ((z) => +z.toFixed(2)))(v))}</text>`).join("");
    s += xt.map((v) => `<text x="${X(v)}" y="${H - m.b + 12}" text-anchor="middle">${esc(minus((xFmt || ((z) => +z.toFixed(2)))(v)))}</text>`).join("");
    s += `<line class="ax" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/><line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    if (xLabel) s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle">${esc(xLabel)}</text>`;
    if (yLabel) s += `<text transform="translate(9 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
    return { X, Y, s };
  }
  /* Multi-series line chart. points: {x, y, id?}. */
  function lineChart({ series, title, xLabel, yLabel, dates, markId, vline, prov, H = 170, yPad = 0.12, fill, W = 460 }) {
    const all = series.flatMap((s) => s.points.filter((p) => isNum(p.y)));
    if (all.length < 2) return na(`${title}: ${all.length ? "only one value, so there is no trend to plot" : NA}`);
    const m = { l: 40, r: 22, t: 20, b: 28 };
    let y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y));
    const pad = (y1 - y0) * yPad || Math.abs(y0) * 0.1 || 1;
    y0 -= pad; y1 += pad;
    const xs = all.map((p) => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
    const uniq = [...new Set(xs)].sort((a, b) => a - b);
    const xTicks = dates ? uniq.filter((_, i, a) => a.length <= 6 || i % Math.ceil(a.length / 5) === 0) : null;
    const f = frame({ W, H, m, x0, x1, y0, y1, xTicks, xFmt: dates ? (v) => new Date(v).toISOString().slice(5, 10) : null, xLabel, yLabel, title, prov });
    let s = f.s;
    if (vline && isNum(vline.x)) s += `<line x1="${f.X(vline.x)}" x2="${f.X(vline.x)}" y1="${m.t}" y2="${H - m.b}" stroke="${COL.acc}" stroke-dasharray="3 3"/><text x="${f.X(vline.x) + 3}" y="${m.t + 8}" style="fill:${COL.acc}">${esc(vline.label || "")}</text>`;
    series.forEach((se) => {
      const pts = se.points.filter((p) => isNum(p.y));
      if (!pts.length) return;
      const d = pts.map((p, i) => `${i ? "L" : "M"}${f.X(p.x).toFixed(1)},${f.Y(p.y).toFixed(1)}`).join("");
      if (fill && pts.length > 1) s += `<path d="${d}L${f.X(pts[pts.length - 1].x)},${H - m.b}L${f.X(pts[0].x)},${H - m.b}Z" fill="${se.color}" opacity=".12"/>`;
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="1.6"${se.dash ? ' stroke-dasharray="4 3"' : ""}/>`;
      if (!se.noDots) s += pts.map((p) => `<circle cx="${f.X(p.x)}" cy="${f.Y(p.y)}" r="${p.id && p.id === markId ? 4.5 : 2.5}" fill="${p.id && p.id === markId ? "#fff" : se.color}" stroke="${se.color}"><title>${esc(se.name)}: ${p.y.toFixed(2)}</title></circle>`).join("");
    });
    const leg = series.length > 1 ? `<div class="leg">${series.map((se) => `<span><i style="background:${se.color}"></i>${esc(se.name)}</span>`).join("")}</div>` : "";
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${s}</svg>${leg}`;
  }
  function sparkline(values, col, markIdx) {
    const v = values.map((x, i) => ({ x: i, y: x })).filter((p) => isNum(p.y));
    if (v.length < 2) return "";
    const W = 120, H = 26, lo = Math.min(...v.map((p) => p.y)), hi = Math.max(...v.map((p) => p.y));
    const X = (i) => 2 + (i / (values.length - 1 || 1)) * (W - 4), Y = (y) => H - 3 - ((y - lo) / (hi - lo || 1)) * (H - 6);
    const d = v.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
    const mk = v.find((p) => p.x === markIdx);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.3" vector-effect="non-scaling-stroke"/>${mk ? `<circle cx="${X(mk.x)}" cy="${Y(mk.y)}" r="2.5" fill="#fff"/>` : ""}</svg>`;
  }
  function histChart({ edges, counts, title, xLabel, prov, colorFn, marks = [] }) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return na();
    const W = 460, H = 190, m = { l: 40, r: 10, t: 20, b: 28 };
    const pcts = counts.map((c) => (100 * c) / total), maxP = Math.max(...pcts);
    const f = frame({ W, H, m, x0: edges[0], x1: edges[edges.length - 1], y0: 0, y1: maxP * 1.08, xLabel, yLabel: "% of pixels", title, prov });
    let s = f.s;
    pcts.forEach((p, i) => {
      const x = f.X(edges[i]), w = f.X(edges[i + 1]) - x, c = colorFn((edges[i] + edges[i + 1]) / 2);
      s += `<rect x="${(x + 0.5).toFixed(1)}" y="${f.Y(p).toFixed(1)}" width="${Math.max(0.5, w - 1).toFixed(1)}" height="${(f.Y(0) - f.Y(p)).toFixed(1)}" fill="rgb(${c})"><title>${fmt(edges[i], 2)} to ${fmt(edges[i + 1], 2)}: ${p.toFixed(1)}%</title></rect>`;
    });
    marks.forEach((mk) => { s += `<line x1="${f.X(mk)}" x2="${f.X(mk)}" y1="${m.t}" y2="${H - m.b}" stroke="${COL.acc}" stroke-dasharray="3 3"/>`; });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} histogram">${s}</svg>`;
  }
  function gridToURL(w, h, pixel) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const cx = c.getContext("2d");
    const img = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const px = pixel(i); if (px) img.data.set(px, i * 4); }
    cx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }

  /* ---------------------------------------------------------- diagrams (shared by pages) */
  function pipelineSVG(steps, opts = {}) {
    const bw = 104, gap = 14, H = 62, W = steps.length * (bw + gap) - gap + 4;
    const cells = steps.map(([t, sub], i) => {
      const x = 2 + i * (bw + gap), hl = opts.highlight && opts.highlight.includes(i);
      return `<g><rect x="${x}" y="14" width="${bw}" height="42" fill="${hl ? "#1f1b14" : "#141418"}" stroke="${hl ? COL.acc : "#34343c"}" rx="8"/>
        <text x="${x + 6}" y="31" class="t" style="font-size:10.5px">${esc(t)}</text><text x="${x + 6}" y="46" style="font-size:9px">${esc(sub || "")}</text>
        <text x="${x}" y="10" style="font-size:9px;fill:#6c6b66">${String(i + 1).padStart(2, "0")}</text>
        ${i < steps.length - 1 ? `<line x1="${x + bw}" y1="35" x2="${x + bw + gap - 2}" y2="35" stroke="${COL.acc}"/><path d="M${x + bw + gap - 5},32 L${x + bw + gap},35 L${x + bw + gap - 5},38z" fill="${COL.acc}"/>` : ""}</g>`;
    }).join("");
    return `<div style="overflow-x:auto"><svg class="diag" viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W, 820)}px;width:100%;max-width:${Math.round(W * 1.15)}px" role="img" aria-label="Pipeline: ${esc(steps.map((s) => s[0]).join(" → "))}">${cells}</svg></div>`;
  }
  const PIPELINE = [
    ["NISAR HDF5", "data/raw/*.h5"], ["Discovery", "walk HDF5 tree"], ["Geolocation", "x/y coords + EPSG"], ["Conversion", "10·log10(σ)"],
    ["Reprojection", "→ EPSG:3857"], ["Downsampling", "avg · ≤1024 px"], ["Change", "Δσ after−before"], ["Statistics", "Δ, %chg, water"], ["EchoSphere", "manifest.js"],
  ];

  /* ======================================================================
     HOME
     ====================================================================== */
  function initHome() {
    $("#data-status").textContent = dataStatusText();
    const locs = buildLocations();
    const thr = DEFAULT_THRESHOLD;
    const palette = [COL.cy, COL.mg, COL.acc, COL.gr, COL.vi, COL.bl, COL.rd];
    const bsObs = (l) => l.observations.filter((o) => o.kinds.includes("backscatter"));
    const allObs = locs.flatMap((l) => l.observations);
    const info = typeof NISAR_MANIFEST_INFO !== "undefined" ? NISAR_MANIFEST_INFO : { filesFound: [], processed: [], failed: [] };
    const nReal = allObs.filter((o) => o.provenance === P.REAL).length, nDemo = allObs.length - nReal;
    const latest = allObs.map((o) => o.date).sort().pop();
    const lastWater = locs.map((l) => { const b = bsObs(l); return b.length ? waterPct(b[b.length - 1], thr) : null; }).filter(isNum);
    const kp = (k, v, sub, prov) => `<div class="kpi"><span class="k"><span>${esc(k)}</span>${prov ? tag(prov) : ""}</span><span class="v">${esc(v)}</span>${sub ? `<span class="d">${esc(sub)}</span>` : ""}</div>`;
    const mixProv = nReal ? (nDemo ? "MIXED" : P.REAL) : P.DEMO;
    $("#home-kpis").innerHTML = [
      kp("Sites", String(locs.length), `${locs.filter((l) => l.provenance === P.REAL).length} real · ${locs.filter((l) => l.provenance === P.DEMO).length} demo`),
      kp("Observations", String(allObs.length), "", mixProv),
      kp("REAL NISAR records", String(nReal), "", P.REAL),
      kp("DEMO observations", String(nDemo), "", P.DEMO),
      kp("Files found", String(info.filesFound.length), "data/raw/*.h5"),
      kp("Processed", String(info.processed.length), `${info.failed.length} failed`),
      kp("Latest obs", latest || NA, "", mixProv),
      kp("Mean open water", lastWater.length ? fmt(lastWater.reduce((a, b) => a + b, 0) / lastWater.length, 1, "%") : NA, `latest per site @ ${thr} dB`, mixProv),
    ].join("");

    const series = locs.filter((l) => bsObs(l).length).map((l, i) => ({ name: `${l.region.toLowerCase()} (${l.provenance})`, color: palette[i % palette.length], points: bsObs(l).map((o) => ({ x: Date.parse(o.date), y: waterPct(o, thr) })) }));
    $("#multi-tag").innerHTML = tag(mixProv);
    $("#home-multi").innerHTML = lineChart({ series, title: `open water % @ ${thr} dB`, yLabel: "%", dates: true, prov: mixProv === "MIXED" ? null : mixProv, H: 300, W: 980 }) +
      (nDemo ? `<p class="cap"><span class="demo-stamp">DEMO DATA</span> · Illustrative trend — not a NASA observation</p>` : "");
    const series2 = locs.filter((l) => bsObs(l).length > 1).map((l, i) => ({ name: l.region.toLowerCase(), color: palette[i % palette.length], points: bsObs(l).slice(1).map((o) => ({ x: Date.parse(o.date), y: o.stats.meanChangeDb })) }));
    $("#home-delta").innerHTML = lineChart({ series: series2, title: "mean Δσ vs previous obs", yLabel: "dB", dates: true, prov: mixProv === "MIXED" ? null : mixProv, H: 300, W: 760 });

    // latest changed area bars
    const bars = locs.map((l, i) => { const b = bsObs(l); const o = b[b.length - 1]; return { l, v: o ? o.stats.percentChanged : null, c: palette[i % palette.length] }; });
    const W = 460, rh = 30, H = 20 + bars.length * rh, mx = Math.max(1, ...bars.map((b) => b.v).filter(isNum));
    $("#home-bars").innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Latest changed area per site">${bars.map((b, i) => {
      const y = 10 + i * rh, w = isNum(b.v) ? (b.v / mx) * (W - 150) : 0;
      return `<text x="0" y="${y + 14}" class="ttl" style="font-size:10px">${esc(b.l.region.toLowerCase())}</text><rect x="80" y="${y + 3}" width="${W - 150}" height="14" fill="#161a20"/><rect x="80" y="${y + 3}" width="${w.toFixed(1)}" height="14" fill="${b.c}"/><text x="${W - 64}" y="${y + 14}">${isNum(b.v) ? fmt(b.v, 1, "%") : "n/a"}</text><text x="${W}" y="${y + 14}" text-anchor="end" style="fill:${b.l.provenance === P.REAL ? "var(--real)" : "var(--demo)"}">${b.l.provenance === P.REAL ? "REAL" : "DEMO"}</text>`;
    }).join("")}</svg><p class="cap">|Δσ| ≥ ${CHANGE_DB} dB vs previous obs</p>`;

    // heatmap site × observation index
    const rows = locs.filter((l) => bsObs(l).length), nCol = Math.max(...rows.map((l) => bsObs(l).length));
    const HW = 760, cw = (HW - 90) / nCol, chh = 26, HH = 24 + rows.length * chh;
    const hv = rows.flatMap((l) => bsObs(l).map((o) => waterPct(o, thr))).filter(isNum), hmx = Math.max(1, ...hv);
    $("#home-heat").innerHTML = `<svg class="chart" viewBox="0 0 ${HW} ${HH}" role="img" aria-label="Open water per site and observation">${rows.map((l, r) => {
      const y = 4 + r * chh;
      return `<text x="0" y="${y + 16}" class="ttl" style="font-size:10px">${esc(l.region.toLowerCase())}</text>` + bsObs(l).map((o, i) => {
        const v = waterPct(o, thr), col = isNum(v) ? color(v / hmx, STOPS.dens) : [30, 30, 30];
        return `<rect x="${(90 + i * cw).toFixed(1)}" y="${y}" width="${(cw - 2).toFixed(1)}" height="${chh - 3}" fill="rgb(${col})"><title>${esc(l.region)} ${esc(o.date)}: ${fmt(v, 1, "%")} (${esc(o.provenance)})</title></rect><text x="${(90 + (i + 0.5) * cw).toFixed(1)}" y="${y + 16}" text-anchor="middle" style="fill:${isNum(v) && v / hmx > 0.55 ? "#111" : "#d3d9e0"}">${isNum(v) ? v.toFixed(0) : "–"}</text>`;
      }).join("");
    }).join("")}${Array.from({ length: nCol }, (_, i) => `<text x="${(90 + (i + 0.5) * cw).toFixed(1)}" y="${HH - 4}" text-anchor="middle">t${i + 1}</text>`).join("")}</svg><p class="cap">% below ${thr} dB · 0 → ${fmt(hmx, 0, "%")}</p>`;

    // site table
    $("#home-sites").innerHTML = `<table class="data cards"><thead><tr><th>Site</th><th>Phenomenon</th><th>Data</th><th class="num">Obs</th><th>Latest</th><th class="num">Open water</th><th class="num">Δσ</th><th>Trend</th></tr></thead><tbody>${locs.map((l, i) => {
      const b = bsObs(l), o = b[b.length - 1] || l.observations[l.observations.length - 1];
      return `<tr><td data-label="Site"><a href="explore.html?loc=${encodeURIComponent(l.key)}">${esc(l.region.toLowerCase())} · ${esc(l.name)}</a></td><td data-label="Phenomenon">${esc(l.phenomenon)}</td><td data-label="Data">${tag(l.provenance)}</td><td data-label="Obs" class="num">${l.observations.length}</td><td data-label="Latest">${esc(o.date)}</td><td data-label="Open water" class="num">${b.length ? fmt(waterPct(o, thr), 1, "%") : NA}</td><td data-label="Δσ" class="num">${signed(o.stats.meanChangeDb, 2, " dB")}</td><td data-label="Trend"><div style="width:80px;height:20px">${sparkline(b.length ? b.map((x) => waterPct(x, thr)) : l.observations.map(meanMotion), palette[i % palette.length])}</div></td></tr>`;
    }).join("")}</tbody></table>`;

    // provenance breakdown
    const parts = [[P.REAL, nReal, "var(--real)", "from your HDF5 files"], [P.DEMO, nDemo, "var(--demo)", "synthetic, illustrative"], [P.SIM, 4, "var(--sim)", "rules · rain · SMS · phone"]];
    const tot = parts.reduce((a, p) => a + p[1], 0) || 1;
    $("#home-prov").innerHTML = `<div style="display:flex;height:14px;margin-bottom:10px">${parts.map((p) => `<div style="width:${(100 * p[1]) / tot}%;background:${p[2]}" title="${p[0]}: ${p[1]}"></div>`).join("")}</div>
      <table class="data"><tbody>${parts.map((p) => `<tr><td>${tag(p[0])}</td><td class="num">${p[1]}</td><td class="fa">${p[0] === P.SIM ? "components" : "observations"}</td><td class="fa">${p[3]}</td></tr>`).join("")}</tbody></table>`;

    // pipeline status
    const ran = info.processed.length > 0;
    $("#home-proc").innerHTML = pipelineSVG(PIPELINE, { highlight: ran ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [8] }) +
      `<table class="data" style="margin-top:8px"><tbody>
        <tr><td class="fa">manifest generated</td><td>${esc(info.generatedAt || NA)}</td></tr>
        <tr><td class="fa">files found</td><td>${info.filesFound.length ? esc(info.filesFound.join(", ")) : "0"}</td></tr>
        <tr><td class="fa">processed</td><td class="status-ok">${info.processed.length}</td></tr>
        <tr><td class="fa">failed</td><td class="${info.failed.length ? "status-err" : ""}">${info.failed.length}${info.failed.length ? " · " + esc(info.failed.map((f) => f.file).join(", ")) : ""}</td></tr>
        <tr><td class="fa">command</td><td><code>python process_nisar.py</code></td></tr>
      </tbody></table>`;
  }

  /* ======================================================================
     BANGLADESH
     ====================================================================== */
  /* Bangladesh data panels: Jamuna observations (DEMO or REAL NISAR) + SIMULATED rain/rules. */
  function renderBangladeshData() {
    const loc = buildLocations().find((l) => l.key === "bangladesh");
    if (!loc || !$("#bd-kpis")) return;
    const thr = DEFAULT_THRESHOLD, pv = loc.provenance;
    const obs = loc.observations.filter((o) => o.kinds.includes("backscatter"));
    const rows = obs.map((o, i) => {
      const w = waterPct(o, thr), wp = i ? waterPct(obs[i - 1], thr) : null;
      const rise = isNum(w) && isNum(wp) && wp > 0 ? ((w - wp) / wp) * 100 : null;
      const rain = isNum(o.simRainfallMm) ? o.simRainfallMm : null;
      const res = i ? RISK_RULES.evaluate(rise, rain) : { level: null };
      return { o, w, rise, rain, level: res.level };
    });
    const last = rows[rows.length - 1] || {};
    const count = (lv) => rows.filter((r) => r.level === lv).length;
    const kp = (k, v, prov, sub) => `<div class="kpi"><span class="k"><span>${esc(k)}</span>${tag(prov)}</span><span class="v${v === NA ? " na" : ""}">${esc(v)}</span>${sub ? `<span class="d">${esc(sub)}</span>` : ""}</div>`;
    $("#bd-kpis").innerHTML = [
      kp("Open water (latest)", fmt(last.w, 1, "%"), pv, `@ ${thr} dB · ${last.o ? last.o.date : ""}`),
      kp("Rise vs prev", signed(last.rise, 0, "%"), pv, "relative"),
      kp("72-h rain (latest)", isNum(last.rain) ? `${last.rain} mm` : NA, P.SIM),
      kp("Current risk", last.level || NA, P.SIM),
      kp("HIGH decisions", String(count("HIGH")), P.SIM, `of ${Math.max(0, rows.length - 1)} evaluations`),
      kp("SMS queued", String(count("HIGH")), P.SIM, "HIGH only"),
      kp("Observations", String(obs.length), pv),
    ].join("");

    // A: trigger timeline — open water (line) + rain (bars) + risk markers
    $("#bd-trig-tag").innerHTML = tag(pv) + " " + tag(P.SIM);
    const W = 900, H = 280, m = { l: 44, r: 50, t: 22, b: 30 };
    const xs = rows.map((r) => Date.parse(r.o.date)), x0 = Math.min(...xs), x1 = Math.max(...xs);
    const wMax = Math.max(1, ...rows.map((r) => r.w).filter(isNum)) * 1.15, rMax = Math.max(1, ...rows.map((r) => r.rain).filter(isNum)) * 1.15;
    const f = frame({ W, H, m, x0: x0 - 4 * 864e5, x1: x1 + 4 * 864e5, y0: 0, y1: wMax, xTicks: xs, xFmt: (v) => new Date(v).toISOString().slice(5, 10), yLabel: "open water %", title: "open water (line) · 72-h rain (bars) · risk (▲)", prov: null });
    const Yr = (v) => H - m.b - (v / rMax) * (H - m.t - m.b);
    let s = "";
    rows.forEach((r) => { if (isNum(r.rain)) s += `<rect x="${(f.X(Date.parse(r.o.date)) - 14).toFixed(1)}" y="${Yr(r.rain).toFixed(1)}" width="28" height="${(H - m.b - Yr(r.rain)).toFixed(1)}" fill="${COL.vi}" opacity=".35"><title>${esc(r.o.date)} rain ${r.rain} mm (SIMULATED)</title></rect>`; });
    s += f.s;
    s += [0, 0.5, 1].map((k) => `<text x="${W - m.r + 4}" y="${Yr(k * rMax) + 3}">${Math.round(k * rMax)}</text>`).join("") + `<text transform="translate(${W - 8} ${(m.t + H - m.b) / 2}) rotate(90)" text-anchor="middle">rain mm (SIM)</text>`;
    const hx = Yr(RISK_RULES.rainHighMm);
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${hx}" y2="${hx}" stroke="${COL.vi}" stroke-dasharray="2 4"/><text x="${W - m.r - 4}" y="${hx - 3}" text-anchor="end" style="fill:${COL.vi}">rain Y=${RISK_RULES.rainHighMm} mm</text>`;
    const pts = rows.filter((r) => isNum(r.w));
    s += `<path d="${pts.map((r, i) => `${i ? "L" : "M"}${f.X(Date.parse(r.o.date)).toFixed(1)},${f.Y(r.w).toFixed(1)}`).join("")}" fill="none" stroke="${COL.cy}" stroke-width="2"/>`;
    const lc = { HIGH: COL.rd, MEDIUM: COL.acc, LOW: COL.gr };
    const sym = { HIGH: "▲▲▲", MEDIUM: "▲▲", LOW: "▲" };
    pts.forEach((r) => {
      s += `<circle cx="${f.X(Date.parse(r.o.date))}" cy="${f.Y(r.w)}" r="4" fill="${COL.cy}"><title>${esc(r.o.date)} ${fmt(r.w, 1, "%")}</title></circle>`;
      if (r.level) s += `<text x="${f.X(Date.parse(r.o.date))}" y="${f.Y(r.w) - 10}" text-anchor="middle" style="fill:${lc[r.level]};font-weight:700">${sym[r.level]}</text>`;
    });
    $("#bd-trigger").innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Open water, simulated rainfall and simulated risk per observation">${s}</svg>
      <div class="leg"><span><i style="background:${COL.cy}"></i>open water % (${esc(pv)})</span><span><i style="background:${COL.vi}"></i>72-h rain (SIMULATED)</span><span style="color:${COL.rd}">▲▲▲ HIGH</span><span style="color:${COL.acc}">▲▲ MEDIUM</span><span style="color:${COL.gr}">▲ LOW</span></div>
      ${pv === P.DEMO ? '<p class="cap"><span class="demo-stamp">DEMO DATA</span> · Illustrative trend — not a NASA observation</p>' : ""}`;

    // B: risk strip
    const SW = 460, sh = 40;
    $("#bd-strip").innerHTML = `<svg class="chart" viewBox="0 0 ${SW} 120" role="img" aria-label="Simulated risk level per observation">
      ${["HIGH", "MEDIUM", "LOW"].map((lv, k) => `<text x="0" y="${24 + k * sh * 0.8}" style="fill:${lc[lv]}">${lv}</text>`).join("")}
      ${rows.map((r, i) => r.level ? `<rect x="${60 + (i / rows.length) * (SW - 70)}" y="${14 + ["HIGH", "MEDIUM", "LOW"].indexOf(r.level) * sh * 0.8}" width="${(SW - 70) / rows.length - 4}" height="16" fill="${lc[r.level]}"><title>${esc(r.o.date)}: ${r.level}</title></rect>` : `<rect x="${60 + (i / rows.length) * (SW - 70)}" y="46" width="${(SW - 70) / rows.length - 4}" height="16" fill="none" stroke="#313946" stroke-dasharray="2 2"><title>${esc(r.o.date)}: first obs, no rule</title></rect>`).join("")}
      ${rows.map((r, i) => `<text x="${60 + ((i + 0.5) / rows.length) * (SW - 70)}" y="112" text-anchor="middle">${r.o.date.slice(5)}</text>`).join("")}
    </svg><p class="cap">inputs: rise vs previous obs (${esc(pv)}) + simulated rain</p>`;

    // C: sensitivity — HIGH count as X varies
    const evalX = (w, r, X) => (!isNum(w) || !isNum(r) ? null : w > X && r > RISK_RULES.rainHighMm ? "HIGH" : w > RISK_RULES.waterMediumPct && r >= RISK_RULES.rainMediumMinMm ? "MEDIUM" : "LOW");
    const Xs = Array.from({ length: 21 }, (_, i) => i * 5);
    const sens = Xs.map((X) => ({ x: X, y: rows.slice(1).filter((r) => evalX(r.rise, r.rain, X) === "HIGH").length }));
    $("#bd-sens").innerHTML = lineChart({ series: [{ name: "HIGH decisions", color: COL.rd, points: sens }], title: "HIGH decisions in history", xLabel: "water-rise threshold X (%)", yLabel: "count", vline: { x: RISK_RULES.waterHighPct, label: `X=${RISK_RULES.waterHighPct}` }, prov: P.SIM, H: 220, fill: true });

    // D: scatter rise vs rain on the rule matrix
    const DW = 460, DH = 240, dm = { l: 44, r: 12, t: 20, b: 30 };
    const pr = rows.filter((r) => isNum(r.rise) && isNum(r.rain));
    const riseMax = Math.max(40, ...pr.map((r) => r.rise)) * 1.1, riseMin = Math.min(-20, ...pr.map((r) => r.rise));
    const df = frame({ W: DW, H: DH, m: dm, x0: 0, x1: 250, y0: riseMin, y1: riseMax, xLabel: "72-h rain mm (SIMULATED)", yLabel: "water rise %", title: `${pr.length} evaluations`, prov: P.SIM });
    let ds = "";
    ds += `<rect x="${df.X(RISK_RULES.rainHighMm)}" y="${df.Y(riseMax)}" width="${df.X(250) - df.X(RISK_RULES.rainHighMm)}" height="${df.Y(RISK_RULES.waterHighPct) - df.Y(riseMax)}" fill="#4a1c1a"/>`;
    ds += `<rect x="${df.X(RISK_RULES.rainMediumMinMm)}" y="${df.Y(RISK_RULES.waterHighPct)}" width="${df.X(250) - df.X(RISK_RULES.rainMediumMinMm)}" height="${df.Y(RISK_RULES.waterMediumPct) - df.Y(RISK_RULES.waterHighPct)}" fill="#3d3214"/>`;
    ds += `<rect x="${df.X(RISK_RULES.rainMediumMinMm)}" y="${df.Y(riseMax)}" width="${df.X(RISK_RULES.rainHighMm) - df.X(RISK_RULES.rainMediumMinMm)}" height="${df.Y(RISK_RULES.waterHighPct) - df.Y(riseMax)}" fill="#3d3214"/>`;
    ds += df.s + pr.map((r) => `<circle cx="${df.X(r.rain)}" cy="${df.Y(r.rise)}" r="5" fill="${lc[r.level]}" stroke="#fff"><title>${esc(r.o.date)}: rise ${fmt(r.rise, 0, "%")}, rain ${r.rain} mm → ${r.level}</title></circle><text x="${df.X(r.rain) + 7}" y="${df.Y(r.rise) + 3}">${r.o.date.slice(5)}</text>`).join("");
    $("#bd-scatter").innerHTML = `<svg class="chart" viewBox="0 0 ${DW} ${DH}" role="img" aria-label="Scatter of water rise against simulated rainfall, over rule zones">${ds}</svg><p class="cap">zones: ■ HIGH ■ MEDIUM · points = past observations</p>`;

    // E: risk mix bars
    const tot = Math.max(1, rows.length - 1);
    $("#bd-mix").innerHTML = `<div style="display:flex;height:22px;margin-bottom:10px">${["HIGH", "MEDIUM", "LOW"].map((lv) => `<div style="width:${(100 * count(lv)) / tot}%;background:${lc[lv]}" title="${lv}: ${count(lv)}"></div>`).join("")}</div>
      <table class="data"><tbody>${["HIGH", "MEDIUM", "LOW"].map((lv) => `<tr><td style="color:${lc[lv]}">${sym[lv]} ${lv}</td><td class="num">${count(lv)}</td><td class="num">${fmt((100 * count(lv)) / tot, 0, "%")}</td></tr>`).join("")}<tr><td class="fa">no rule (first obs)</td><td class="num">1</td><td></td></tr></tbody></table>
      <p class="cap">${tag(P.SIM)} prototype rules · not a forecast</p>`;

    // F: alert log
    $("#bd-log").innerHTML = `<table class="data cards"><thead><tr><th>Date</th><th>Source</th><th class="num">Open water</th><th class="num">Rise</th><th class="num">Rain (SIM)</th><th>Risk (SIM)</th><th>SMS (SIM)</th></tr></thead><tbody>${rows.slice().reverse().map((r) => `<tr><td data-label="Date">${esc(r.o.date)}</td><td data-label="Source">${tag(r.o.provenance)}</td><td data-label="Open water" class="num">${fmt(r.w, 1, "%")}</td><td data-label="Rise" class="num">${signed(r.rise, 0, "%")}</td><td data-label="Rain (SIM)" class="num">${isNum(r.rain) ? r.rain + " mm" : NA}</td><td data-label="Risk (SIM)">${r.level ? `<span style="color:${lc[r.level]}">${sym[r.level]} ${r.level}</span>` : '<span class="fa">no rule</span>'}</td><td data-label="SMS (SIM)">${r.level === "HIGH" ? '<span class="status-ok">queued</span>' : '<span class="fa">—</span>'}</td></tr>`).join("")}</tbody></table>`;
  }
  function initBangladesh() {
    renderBangladeshData();
    const water = $("#rule-water"), rain = $("#rule-rain");
    if (!water || !rain) return;
    $("#sms-text").textContent = SIMULATED_SMS_BN;
    $("#flow-diag").innerHTML = pipelineSVG([["NISAR", "flood / erosion"], ["TRIGGER", "water ↑ > X%"], ["GPM IMERG", "rain context"], ["RULE ENGINE", "risk decision"], ["SMS GATEWAY", "operator"], ["FEATURE PHONE", "2G · Bangla"]], { highlight: [0] });
    const matrix = $("#rule-matrix");
    const WMAX = 100, RMAX = 250, W = 460, H = 260, m = { l: 40, r: 10, t: 20, b: 30 };
    const draw = () => {
      const w = Number(water.value), r = Number(rain.value);
      const f = frame({ W, H, m, x0: 0, x1: RMAX, y0: 0, y1: WMAX, xLabel: "72-h rainfall (mm) · SIMULATED", yLabel: "open-water rise (%)", title: "Rule matrix · risk by inputs", prov: P.SIM });
      let s = "";
      const fillFor = { LOW: "#173325", MEDIUM: "#3d3214", HIGH: "#4a1c1a" };
      for (let x = 0; x < RMAX; x += 5) for (let y = 0; y < WMAX; y += 2) {
        const lv = RISK_RULES.evaluate(y + 1, x + 2.5).level;
        s += `<rect x="${f.X(x).toFixed(1)}" y="${f.Y(y + 2).toFixed(1)}" width="${(f.X(x + 5) - f.X(x) + 0.4).toFixed(1)}" height="${(f.Y(y) - f.Y(y + 2) + 0.4).toFixed(1)}" fill="${fillFor[lv]}"/>`;
      }
      s += `<text x="${f.X(170)}" y="${f.Y(70)}" style="fill:#e5534b;font-size:12px;font-weight:600">▲▲▲ HIGH</text><text x="${f.X(150)}" y="${f.Y(14)}" style="fill:#e0a526;font-size:12px;font-weight:600">▲▲ MEDIUM</text><text x="${f.X(8)}" y="${f.Y(55)}" style="fill:#5cc28a;font-size:12px;font-weight:600">▲ LOW</text>`;
      s += `<circle cx="${f.X(r)}" cy="${f.Y(w)}" r="6" fill="none" stroke="#fff" stroke-width="2"/><line x1="${f.X(r)}" x2="${f.X(r)}" y1="${m.t}" y2="${H - m.b}" stroke="#fff" stroke-opacity=".3"/><line x1="${m.l}" x2="${W - m.r}" y1="${f.Y(w)}" y2="${f.Y(w)}" stroke="#fff" stroke-opacity=".3"/>`;
      matrix.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rule matrix: risk level for each combination of rainfall and open-water rise. Click to set inputs." style="cursor:crosshair">${s}${f.s}</svg>`;
    };
    matrix.addEventListener("click", (e) => {
      const svg = matrix.querySelector("svg");
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
      rain.value = String(Math.round(clamp(((px - m.l) / (W - m.l - m.r)) * RMAX, 0, RMAX) / 5) * 5);
      water.value = String(Math.round(clamp(((H - m.b - py) / (H - m.t - m.b)) * WMAX, 0, WMAX)));
      update();
    });
    const update = () => {
      const w = Number(water.value), r = Number(rain.value);
      $("#rule-water-out").textContent = `${w}%`;
      $("#rule-rain-out").textContent = `${r} mm`;
      const res = RISK_RULES.evaluate(w, r);
      $("#rule-result").innerHTML = `<span class="risk-level risk-${res.level}" role="status">${res.level}</span>`;
      $("#rule-fired").textContent = res.rule;
      $$("[data-rule]").forEach((el) => el.classList.toggle("active", Number(el.dataset.rule) === res.ruleIndex));
      $("#phone-state").textContent = res.level === "HIGH" ? "Emergency SMS sent to all registered phones" : `No SMS sent · risk ${res.level}`;
      $("#sms-screen").hidden = res.level !== "HIGH";
      $("#sms-idle").hidden = res.level === "HIGH";
      draw();
    };
    water.addEventListener("input", update);
    rain.addEventListener("input", update);
    update();
  }

  /* ======================================================================
     ABOUT
     ====================================================================== */
  function initAbout() {
    const el = $("#about-pipeline");
    if (el) el.innerHTML = pipelineSVG([["NISAR HDF5", "user files"], ["Discovery", "dataset search"], ["Geolocation", "coords + EPSG"], ["Processing", "dB · phase · offsets"], ["Reprojection", "EPSG:3857"], ["Visualization", "PNG < 1 MB"], ["Statistics", "Δ, hist, water"], ["EchoSphere", "manifest.js"]]);
    if (!$("#ab-bands")) return;
    const palette = [COL.cy, COL.mg, COL.acc, COL.gr];
    const locs = buildLocations().map((l) => Object.assign({}, l, { observations: l.observations.filter((o) => o.kinds.includes("backscatter")) })).filter((l) => l.observations.length);

    // 1. wavelength bars (reference values)
    const bands = [["L-band (NISAR · NASA)", 24, COL.cy, true], ["S-band (NISAR · ISRO)", 10, COL.mg, true], ["C-band (reference)", 5.6, COL.fa, false], ["X-band (reference)", 3.1, COL.fa, false]];
    const BW = 460, bh = 34;
    $("#ab-bands").innerHTML = `<svg class="chart" viewBox="0 0 ${BW} ${bands.length * bh + 24}" role="img" aria-label="Radar wavelength comparison">${bands.map(([n, v, c, nisar], i) => `<text x="0" y="${i * bh + 18}" class="${nisar ? "ttl" : ""}" style="font-size:10px">${esc(n)}</text><rect x="170" y="${i * bh + 6}" width="${((v / 25) * (BW - 230)).toFixed(1)}" height="16" fill="${c}"/><text x="${176 + (v / 25) * (BW - 230)}" y="${i * bh + 18}">~${v} cm</text>`).join("")}</svg>`;

    // 2. repeat cycle: passes over one year
    const CW = 460, CH = 90, days = 365, rep = 12, n = Math.floor(days / rep) + 1;
    let cs = `<line x1="10" x2="${CW - 10}" y1="40" y2="40" stroke="#313946"/>`;
    for (let i = 0; i < n; i++) { const x = 10 + ((i * rep) / days) * (CW - 20); cs += `<rect x="${x.toFixed(1)}" y="30" width="2.5" height="20" fill="${COL.acc}"><title>day ${i * rep}</title></rect>`; }
    ["Jan", "Apr", "Jul", "Oct"].forEach((mn, k) => { const x = 10 + ((k * 91) / days) * (CW - 20); cs += `<text x="${x}" y="68">${mn}</text>`; });
    cs += `<text x="10" y="18" class="ttl">${n} repeat passes / year at ~${rep}-day cycle</text>`;
    $("#ab-repeat").innerHTML = `<svg class="chart" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${n} passes per year">${cs}</svg>`;

    // 3. threshold sensitivity per site (DEMO)
    const T = Array.from({ length: 17 }, (_, i) => i - 26);
    $("#ab-thr").innerHTML = lineChart({ series: locs.map((l, i) => ({ name: l.region.toLowerCase(), color: palette[i], points: T.map((t) => ({ x: t, y: waterPct(l.observations[l.observations.length - 1], t) })) })), title: "open water % vs threshold · latest obs per site", xLabel: "threshold (dB)", yLabel: "%", vline: { x: DEFAULT_THRESHOLD, label: `${minus(DEFAULT_THRESHOLD)} dB` }, prov: null, H: 300, W: 720 }) +
      `<p class="cap">spread at one threshold = interpretation uncertainty</p>`;

    // 4. pixel dB distributions (class overlap / speckle)
    const edges = Array.from({ length: 41 }, (_, i) => -32 + i);
    const hist = (vals) => { const c = new Array(edges.length - 1).fill(0); let n2 = 0; vals.forEach((v) => { if (Number.isFinite(v)) { c[clamp(Math.floor(v - edges[0]), 0, c.length - 1)]++; n2++; } }); return c.map((x) => (100 * x) / (n2 || 1)); };
    $("#ab-dist").innerHTML = lineChart({ series: locs.map((l, i) => ({ name: l.region.toLowerCase(), color: palette[i], noDots: true, points: hist(getGrid(l.observations[l.observations.length - 1]).values).map((y, k) => ({ x: edges[k] + 0.5, y })) })), title: "pixel backscatter distribution · latest obs", xLabel: "σ (dB)", yLabel: "% pixels", vline: { x: DEFAULT_THRESHOLD, label: "threshold" }, prov: null, H: 300, yPad: 0.02, W: 720 }) +
      `<p class="cap">overlap between modes = misclassification risk</p>`;

    // 5. downsampling effect on open-water estimate
    const block = (g, k) => {
      const w = Math.floor(g.w / k), h = Math.floor(g.h / k), out = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const v = g.values[(y * k + dy) * g.w + x * k + dx]; if (Number.isFinite(v)) { s += Math.pow(10, v / 10); c++; } }
        out[y * w + x] = c ? 10 * Math.log10(s / c) : NaN; // average in linear power, like process_nisar.py
      }
      return out;
    };
    const ks = [1, 2, 4, 8, 16];
    $("#ab-down").innerHTML = lineChart({ series: locs.map((l, i) => { const g = getGrid(l.observations[l.observations.length - 1]); return { name: l.region.toLowerCase(), color: palette[i], points: ks.map((k) => ({ x: k, y: summarize(k === 1 ? g.values : block(g, k), DEFAULT_THRESHOLD).waterPct })) }; }), title: `open water % vs downsampling factor @ ${DEFAULT_THRESHOLD} dB`, xLabel: "block size (px)", yLabel: "%", prov: null, H: 230 }) +
      `<p class="cap">linear-power block average · narrow water lost as blocks grow</p>`;

    // 6. change magnitude per site (DEMO)
    $("#ab-change").innerHTML = lineChart({ series: locs.map((l, i) => ({ name: l.region.toLowerCase(), color: palette[i], points: l.observations.slice(1).map((o, k) => ({ x: k + 2, y: o.stats.percentChanged })) })), title: "% pixels with |Δσ| ≥ 3 dB per observation", xLabel: "observation #", yLabel: "%", prov: null, H: 230 }) +
      `<p class="cap">includes speckle-driven change at zero true change</p>`;

    // 7. product × output support matrix
    const outs = ["σ", "Δσ", "water", "hist", "disp.", "dir.", "vel."];
    const sup = { GCOV: [2, 2, 1, 2, 0, 0, 0], GUNW: [0, 0, 0, 0, 1, 0, 0], GOFF: [0, 0, 0, 0, 2, 1, 0] };
    const cell = { 2: [COL.gr, "✓"], 1: [COL.acc, "~"], 0: ["#1c2129", "—"] };
    const MW = 460, cw = (MW - 60) / outs.length;
    $("#ab-matrix").innerHTML = `<svg class="chart" viewBox="0 0 ${MW} 150" role="img" aria-label="Which outputs each product supports">${outs.map((o, j) => `<text x="${60 + (j + 0.5) * cw}" y="14" text-anchor="middle" style="font-size:9px">${esc(o)}</text>`).join("")}${Object.entries(sup).map(([p, row], i) => `<text x="0" y="${44 + i * 36}" class="ttl">${p}</text>` + row.map((v, j) => `<rect x="${60 + j * cw + 1}" y="${24 + i * 36}" width="${cw - 2}" height="30" fill="${cell[v][0]}" opacity="${v ? 0.8 : 1}"/><text x="${60 + (j + 0.5) * cw}" y="${44 + i * 36}" text-anchor="middle" style="fill:${v ? "#111" : "#5c6570"};font-weight:700">${cell[v][1]}</text>`).join("")).join("")}</svg>
      <p class="cap">σ backscatter · Δσ change · disp. displacement · dir. direction · vel. velocity<br>✓ supported · ~ derived / partial (GUNW: LOS if λ in file · GOFF: radar geometry only) · — not provided</p>`;

    // 8. processing budget
    const budget = [["read cap", 4096, "px / axis"], ["overlay", 1024, "px max side"], ["preview grid", 200, "px max side"], ["change grid", 200, "px max side"]];
    const PW = 460, ph = 30, lmax = Math.log10(5000);
    $("#ab-budget").innerHTML = `<svg class="chart" viewBox="0 0 ${PW} ${budget.length * ph + 30}" role="img" aria-label="Processing size limits">${budget.map(([n2, v, u], i) => `<text x="0" y="${i * ph + 18}">${esc(n2)}</text><rect x="100" y="${i * ph + 6}" width="${((Math.log10(v) / lmax) * (PW - 220)).toFixed(1)}" height="16" fill="${COL.cy}"/><text x="${106 + (Math.log10(v) / lmax) * (PW - 220)}" y="${i * ph + 18}">${v} ${esc(u)}</text>`).join("")}<text x="0" y="${budget.length * ph + 22}">PNG limit: &lt; 1,000,000 bytes each · log scale</text></svg>`;
  }

  /* ======================================================================
     EXPLORE
     ====================================================================== */
  let LOCS = [];
  let map = null, basePane = null, beforePane = null, transectLine = null;
  let activeLayers = [];
  const overlayCache = new Map();
  const S = { locKey: null, layer: null, index: 0, beforeIdx: null, threshold: DEFAULT_THRESHOLD, opacity: 0.8, comparing: false, swipePct: 50, timer: null, sortDesc: true, rainfall: null, transect: 0.5, showOverlay: false };

  function ctx() {
    const loc = LOCS.find((l) => l.key === S.locKey) || LOCS[0];
    const series = seriesFor(loc, S.layer);
    const idx = clamp(S.index, 0, Math.max(0, series.length - 1));
    const obs = series[idx] || null;
    const prev = idx > 0 ? series[idx - 1] : null;
    const bIdx = S.beforeIdx != null && S.beforeIdx < idx ? S.beforeIdx : idx - 1;
    const before = bIdx >= 0 ? series[bIdx] : null;
    return { loc, series, idx, obs, prev, before, bIdx, layer: S.layer, thr: S.threshold };
  }
  const cached = (key, make) => { if (!overlayCache.has(key)) overlayCache.set(key, make()); return overlayCache.get(key); };
  const gridNote = (pv) => (pv === P.REAL ? `<p class="cap">src: ≤200 px preview grid</p>` : "");

  function floodURL(o, prev, thr, landTransparent) {
    const g = getGrid(o);
    if (!g) return null;
    const pg = prev ? getGrid(prev) : null, same = pg && pg.w === g.w && pg.h === g.h;
    return cached(`flood|${o.id}|${prev ? prev.id : ""}|${thr}|${landTransparent}`, () => gridToURL(g.w, g.h, (i) => {
      const v = g.values[i];
      if (!Number.isFinite(v)) return null;
      if (v < thr) { const pv = same ? pg.values[i] : NaN; return Number.isFinite(pv) && pv >= thr ? [229, 143, 180, 240] : [110, 195, 212, 225]; }
      if (landTransparent) return null;
      const c = color((v + 25) / 25, STOPS.gray);
      return [c[0], c[1], c[2], 210];
    }));
  }
  function changeURL(o, prev) {
    const g = getGrid(o), pg = prev && getGrid(prev);
    if (!g || !pg || pg.w !== g.w || pg.h !== g.h) return null;
    return cached(`change|${o.id}|${prev.id}`, () => gridToURL(g.w, g.h, (i) => {
      const d = g.values[i] - pg.values[i];
      if (!Number.isFinite(d)) return null;
      const c = color((d + 6) / 12, STOPS.div);
      return [c[0], c[1], c[2], 225];
    }));
  }
  function motionURL(o) {
    const g = motionGrid(o);
    if (!g) return null;
    const [lo, hi] = o.stats.legendRange || [0, 1];
    const stops = o.product === "GUNW" ? STOPS.div : STOPS.mag;
    return cached(`motion|${o.id}`, () => gridToURL(g.w, g.h, (i) => {
      const v = g.values[i];
      if (!Number.isFinite(v)) return null;
      const c = color((v - lo) / (hi - lo || 1), stops);
      return [c[0], c[1], c[2], 230];
    }));
  }
  function imageryFor(o, prev, layer, thr) {
    if (!o) return { urls: [], reason: "No observation available for this layer." };
    if (layer === "flood") {
      const urls = [];
      if (o.overlays.backscatter) urls.push(o.overlays.backscatter);
      const u = floodURL(o, prev, thr, !!o.overlays.backscatter);
      if (u) urls.push(u);
      return { urls, reason: urls.length ? "" : "Backscatter overlay not available." };
    }
    if (layer === "change") {
      if (o.overlays.change) return { urls: [o.overlays.change], reason: "" };
      const u = o.provenance === P.DEMO && prev ? changeURL(o, prev) : null;
      if (u) return { urls: [u], reason: "" };
      return { urls: [], reason: prev ? "Change overlay not available for this observation." : "First observation · nothing earlier to compare with." };
    }
    const src = o.overlays.motion || motionURL(o);
    return { urls: src ? [src] : [], reason: src ? "" : "Motion overlay not available." };
  }

  /* ---------------------------------------------------------- map */
  function initMap() {
    if (typeof L === "undefined") { $("#map").innerHTML = '<div class="map-empty">Leaflet could not be loaded (offline?). The charts still work.</div>'; return; }
    map = L.map("map", { zoomSnap: 0.25, worldCopyJump: true });
    // Esri World Dark Gray: keyless and works from file:// pages (CARTO/OSM tiles require a Referer).
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: 'Basemap &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 16,
    }).addTo(map);
    basePane = map.createPane("afterPane"); basePane.style.zIndex = 410;
    beforePane = map.createPane("beforePane"); beforePane.style.zIndex = 420;
    const legendCtl = L.control({ position: "bottomright" });
    legendCtl.onAdd = () => { const d = L.DomUtil.create("div", "legend"); d.id = "legend"; L.DomEvent.disableClickPropagation(d); return d; };
    legendCtl.addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    map.on("move zoom resize viewreset", applyClip);
  }
  function addImages(urls, bounds, pane) {
    urls.forEach((url) => {
      const lyr = L.imageOverlay(url, bounds, { pane, opacity: S.opacity, interactive: false, alt: "" });
      lyr.on("error", () => setChip(`Overlay could not be loaded (${url.startsWith("data:") ? "generated" : url}).`));
      lyr.addTo(map);
      activeLayers.push(lyr);
    });
  }
  const setChip = (t) => { $("#map-chip").textContent = t; };
  function renderMap(c) {
    $("#map-title").textContent = `Map · ${LAYER_NAMES[c.layer]}${c.obs ? " · " + c.obs.date : ""}`;
    $("#map-tag").innerHTML = c.obs ? tag(c.obs.provenance) : "";
    if (!map) return;
    activeLayers.forEach((l) => map.removeLayer(l));
    activeLayers = [];
    let chip = "";
    $("#ov-tag").innerHTML = c.obs ? tag(c.obs.provenance) : "";
    $("#analysis-src").textContent = c.obs ? `· ${c.obs.provenance}` : "";
    if (!S.showOverlay) {
      $("#map-title").textContent = "Map · live NASA layers";
      $("#map-tag").innerHTML = '<span class="tag tag-live">LIVE NASA</span>';
      setChip(""); drawTransectLine(c); applyClip(); return;
    }
    if (S.comparing && c.before) {
      const lay = c.layer === "change" ? "flood" : c.layer;
      addImages(imageryFor(c.obs, c.prev, lay, c.thr).urls, c.obs.bounds, "afterPane");
      addImages(imageryFor(c.before, c.bIdx > 0 ? c.series[c.bIdx - 1] : null, lay, c.thr).urls, c.before.bounds, "beforePane");
      if (c.layer === "change") chip = "Comparing the open-water classification of both dates";
      $("#swipe-before").innerHTML = `BEFORE ${esc(c.before.date)} ${tag(c.before.provenance)}`;
      $("#swipe-after").innerHTML = `AFTER ${esc(c.obs.date)} ${tag(c.obs.provenance)}`;
    } else {
      const after = imageryFor(c.obs, c.prev, c.layer, c.thr);
      addImages(after.urls, c.obs ? c.obs.bounds : c.loc.bounds, "afterPane");
      chip = after.reason;
    }
    setChip(chip);
    drawTransectLine(c);
    applyClip();
  }
  function drawTransectLine(c) {
    if (!map) return;
    if (transectLine) { map.removeLayer(transectLine); transectLine = null; }
    if (!S.showOverlay) return;
    const b = c.obs ? c.obs.bounds : c.loc.bounds, lat = transectLat(b, c.obs);
    transectLine = L.polyline([[lat, b[0][1]], [lat, b[1][1]]], { color: COL.acc, weight: 2, dashArray: "5 4", interactive: false }).addTo(map);
  }
  /* Latitude of the transect row (real-data grids use Web Mercator rows). */
  function transectLat(b, o) {
    const g = o && (getGrid(o) || motionGrid(o));
    const f = S.transect;
    if (g && g.mercator) {
      const y = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      const yn = y(b[1][0]) - f * (y(b[1][0]) - y(b[0][0]));
      return (360 / Math.PI) * Math.atan(Math.exp(yn)) - 90;
    }
    return b[1][0] - f * (b[1][0] - b[0][0]);
  }
  function applyClip() {
    if (!map || !basePane) return;
    const on = S.comparing;
    $("#map-wrap").classList.toggle("comparing", on);
    if (!on) { basePane.style.clip = ""; beforePane.style.clip = ""; return; }
    const size = map.getSize(), x = Math.round((size.x * S.swipePct) / 100);
    const nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
    beforePane.style.clip = `rect(${nw.y}px, ${nw.x + x}px, ${se.y}px, ${nw.x}px)`;
    basePane.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${nw.x + x}px)`;
    const h = $("#swipe");
    h.style.left = `${x}px`; h.style.height = `${size.y}px`;
    h.setAttribute("aria-valuenow", String(Math.round(S.swipePct)));
    h.setAttribute("aria-valuetext", `${Math.round(S.swipePct)} percent: before on the left, after on the right`);
  }
  function initSwipe() {
    const h = $("#swipe");
    let drag = false;
    const setX = (cx) => { const r = $("#map").getBoundingClientRect(); S.swipePct = clamp(((cx - r.left) / r.width) * 100, 2, 98); applyClip(); };
    h.addEventListener("pointerdown", (e) => { drag = true; h.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
    h.addEventListener("pointermove", (e) => { if (drag) setX(e.clientX); });
    h.addEventListener("pointerup", () => { drag = false; });
    h.addEventListener("pointercancel", () => { drag = false; });
    h.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 2;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") S.swipePct = clamp(S.swipePct - step, 2, 98);
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") S.swipePct = clamp(S.swipePct + step, 2, 98);
      else if (e.key === "Home") S.swipePct = 2;
      else if (e.key === "End") S.swipePct = 98;
      else return;
      e.preventDefault(); applyClip();
    });
  }
  function legendHTML(c) {
    const o = c.obs, pv = o ? tag(o.provenance) : "", demo = o && o.provenance === P.DEMO;
    if (c.layer === "flood") return `<h4>Flood / Open water ${pv}</h4><ul>
      <li><span class="sw" style="background:linear-gradient(90deg,#080c14,#ebf0fa)"></span>Land ≥ ${minus(c.thr)} dB</li>
      <li><span class="sw" style="background:#35b6d6"></span>Open water &lt; ${minus(c.thr)} dB (approx.)</li>
      <li><span class="sw" style="background:#e0569b"></span>Approximate detected change (new since prev. date)</li></ul>
      <p class="note">exploratory threshold · not validated${demo ? " · illustrative dB (DEMO)" : ""}</p>`;
    if (c.layer === "change") return `<h4>Surface change ${pv}</h4><div class="bar" style="background:linear-gradient(90deg,#2166ac,#f5f5f5,#b2182b)"></div>
      <div class="ends"><span>−6 dB</span><span>0</span><span>+6 dB</span></div>
      <ul><li><span class="sw" style="background:#2166ac"></span>Decrease</li><li><span class="sw" style="background:#f5f5f5"></span>No major change</li><li><span class="sw" style="background:#b2182b"></span>Increase</li></ul>
      <p class="note">Δ vs previous date${demo ? " · illustrative dB (DEMO)" : " (dB)"}</p>`;
    if (!o) return `<h4>Deformation / Motion</h4><p class="note">${NA}</p>`;
    const [lo, hi] = o.stats.legendRange || [0, 1], gunw = o.product === "GUNW";
    const units = demo ? "relative, unitless (DEMO, not a physical measurement)" : gunw ? o.stats.phaseUnits || NA : o.stats.displacementUnits || NA;
    return `<h4>${gunw ? "Unwrapped phase" : "Motion magnitude"} ${pv}</h4><div class="bar" style="background:linear-gradient(90deg,${gunw ? "#2166ac,#f5f5f5,#b2182b" : "#0d0887,#cc4778,#f0f921"})"></div>
      <div class="ends"><span>${fmt(lo, 2)}</span><span>${fmt(hi, 2)}</span></div><p class="note">units: ${esc(units)}${demo ? "" : "<br>displacement between two dates, not velocity"}</p>`;
  }

  /* ---------------------------------------------------------- panels */
  function renderControls(c) {
    const seg = $("#layer-seg");
    seg.innerHTML = "";
    ["flood", "change", "motion"].forEach((k) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = LAYER_NAMES[k];
      b.setAttribute("aria-pressed", String(k === c.layer));
      b.style.cssText = "border-right:0;border-bottom:1px solid var(--ln2);text-align:left";
      b.disabled = !c.loc.layers.includes(k);
      if (b.disabled) b.title = "Not appropriate or not available for this dataset";
      b.addEventListener("click", () => { stopPlay(); S.layer = k; S.beforeIdx = null; S.index = seriesFor(c.loc, k).length - 1; update(); });
      seg.appendChild(b);
    });
    $("#threshold-panel").hidden = c.layer === "motion";
    const time = $("#time"), n = c.series.length;
    time.max = String(Math.max(0, n - 1)); time.value = String(c.idx); time.disabled = n < 2;
    time.setAttribute("aria-valuetext", c.obs ? `${c.obs.date} (${c.idx + 1} of ${n})` : NA);
    const show = Math.min(n, 6), ticks = [];
    for (let k = 0; k < show; k++) ticks.push(c.series[show === 1 ? 0 : Math.round((k * (n - 1)) / (show - 1))].date.slice(5));
    $("#ticks").innerHTML = ticks.map((d) => `<span>${esc(d)}</span>`).join("");
    const playing = !!S.timer;
    $("#btn-play").disabled = n < 2 || playing;
    $("#btn-pause").disabled = !playing;
    $("#btn-play").title = n < 2 ? "Only one observation · playback disabled" : "";
    const bs = $("#before-select");
    bs.innerHTML = c.idx > 0 ? c.series.slice(0, c.idx).map((o, i) => `<option value="${i}"${i === c.bIdx ? " selected" : ""}>before: ${esc(o.date)}</option>`).join("") : "<option>no earlier date</option>";
    bs.disabled = c.idx === 0;
    const cmp = $("#btn-compare");
    cmp.disabled = !c.before || !S.showOverlay;
    if ((!c.before || !S.showOverlay) && S.comparing) S.comparing = false;
    cmp.setAttribute("aria-pressed", String(S.comparing));
  }
  function renderStrip(c) {
    const o = c.obs;
    $("#mb-location").textContent = `${c.loc.region} · ${c.loc.name}`;
    $("#mb-product").textContent = o ? o.productLabel : NA;
    $("#mb-acq").textContent = o ? (o.datetime || o.date) + (o.provenance === P.DEMO ? " (illustrative)" : "") : NA;
    $("#mb-granule").textContent = o && o.granule ? o.granule : NA;
    $("#mb-granule").title = o && o.granuleSource ? `Source: ${o.granuleSource}` : "";
    $("#mb-maturity").textContent = o && o.maturity ? o.maturity : NA;
    $("#mb-badge").innerHTML = tag(o ? o.provenance : c.loc.provenance, true);
    const n = $("#data-notice");
    n.textContent = dataStatusText();
    n.className = "notice" + (manifest().length ? " real" : "");
  }
  function renderSites(c) {
    $("#sites-count").textContent = String(LOCS.length);
    $("#sites").innerHTML = `<thead><tr><th>Site</th><th>Data</th><th class="num">Obs</th><th>Trend</th></tr></thead><tbody>${LOCS.map((l) => {
      const bs = l.observations.filter((o) => o.kinds.includes("backscatter"));
      const vals = bs.length ? bs.map((o) => waterPct(o, c.thr)) : l.observations.map(meanMotion);
      return `<tr class="${l.key === c.loc.key ? "current" : ""}"><td><button type="button" class="lnk" data-loc="${esc(l.key)}">${esc(l.region.slice(0, 1) + l.region.slice(1).toLowerCase())}</button></td><td>${tag(l.provenance)}</td><td class="num">${l.observations.length}</td><td><div style="width:64px;height:18px">${sparkline(vals, bs.length ? COL.cy : COL.vi)}</div></td></tr>`;
    }).join("")}</tbody>`;
    $$("#sites [data-loc]").forEach((b) => b.addEventListener("click", () => { $("#loc-select").value = b.dataset.loc; selectLocation(b.dataset.loc); }));
  }
  function renderLocCard(c) {
    const l = c.loc, obs = l.observations, first = obs[0], last = obs[obs.length - 1];
    const span = first && last ? daysBetween(first.date, last.date) : null;
    $("#loc-card").innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:6px"><b>${esc(l.region)} · ${esc(l.name)}</b>${tag(l.provenance)}</div>
      ${l.provenance === P.DEMO ? `<p class="cap" style="margin:0 0 6px">DEMO LOCATION · illustrative scenario</p>` : l.replacedDemo ? `<p class="cap" style="margin:0 0 6px">Real data replaced the demo scenario here.</p>` : ""}
      <dl class="kv"><dt>Phenomenon</dt><dd>${esc(l.phenomenon)}</dd><dt>Dataset</dt><dd>${esc(l.provenance)}</dd><dt>Product</dt><dd>${esc(l.productLabel)}</dd>
      <dt>Latest</dt><dd>${last ? esc(last.date) : NA}</dd><dt>Observations</dt><dd>${obs.length}</dd><dt>Time span</dt><dd>${isNum(span) ? Math.round(span) + " days" : NA}</dd>
      <dt>Bounds</dt><dd>${l.bounds.map((p) => p.map((v) => v.toFixed(2)).join(", ")).join(" → ")}</dd></dl>`;
  }
  function kpi(k, v, prov, { spark, col = COL.cy, delta, dClass = "", idx } = {}) {
    return `<div class="kpi"><span class="k"><span>${esc(k)}</span>${tag(prov)}</span><span class="v${v === NA ? " na" : ""}">${esc(v)}</span>${delta ? `<span class="d ${dClass}">${esc(delta)}</span>` : ""}${spark ? sparkline(spark, col, idx) : ""}</div>`;
  }
  function renderMetrics(c) {
    const o = c.obs, box = $("#metrics");
    if (!o) { box.innerHTML = na(); $("#flood-banner").innerHTML = ""; return; }
    const st = o.stats, pv = o.provenance, ser = c.series;
    if (c.layer === "motion") {
      $("#flood-banner").innerHTML = "";
      const hasD = isNum(st.meanDisplacement), u = pv === P.DEMO ? "rel." : st.displacementUnits || st.phaseUnits || "";
      const pick = (d, p) => (hasD ? st[d] : st[p]);
      box.innerHTML = [
        kpi(hasD ? "Mean displacement" : "Mean phase", `${fmt(pick("meanDisplacement", "meanPhase"), 3)} ${u}`.trim(), pv, { spark: ser.map(meanMotion), col: COL.vi, idx: c.idx }),
        kpi(hasD ? "Max displacement" : "Max phase", fmt(pick("maxDisplacement", "maxPhase"), 3), pv, { spark: ser.map((x) => (hasD ? x.stats.maxDisplacement : x.stats.maxPhase)), col: COL.vi, idx: c.idx }),
        kpi(hasD ? "Min displacement" : "Min phase", fmt(pick("minDisplacement", "minPhase"), 3), pv),
        kpi("Units", pv === P.DEMO ? "relative (unitless)" : st.displacementUnits || st.phaseUnits || NA, pv),
        kpi("Interval", isNum(st.intervalDays) ? `${fmt(st.intervalDays, 0)} d` : NA, pv),
        kpi("Direction", o.product === "GOFF" ? "radar geometry" : NA, pv),
        kpi("Acquisition", o.date + (pv === P.DEMO ? " (illustrative)" : ""), pv),
        kpi("Spatial extent", isNum(st.analyzedAreaKm2) ? `${fmt(st.analyzedAreaKm2, 0)} km²` : NA, pv),
        kpi("Data maturity", o.maturity || NA, pv),
      ].join("");
      return;
    }
    $("#flood-banner").innerHTML = `<div style="padding:8px 10px;border-bottom:1px solid var(--ln)"><span class="flag">NOT A VALIDATED OPERATIONAL FLOOD MAP</span><div class="cap">Approximate open-water detection based on a backscatter threshold; not a validated operational flood product. Threshold ${minus(c.thr)} dB.</div></div>`;
    const wp = waterPct(o, c.thr), wprev = c.prev ? waterPct(c.prev, c.thr) : null, wk = waterKm2(o, c.thr);
    const dW = isNum(wp) && isNum(wprev) ? wp - wprev : null;
    const dB = c.prev && isNum(st.meanBackscatterDb) && isNum(c.prev.stats.meanBackscatterDb) ? st.meanBackscatterDb - c.prev.stats.meanBackscatterDb : null;
    box.innerHTML = [
      kpi("Open-water estimate", isNum(wp) ? `${fmt(wp, 1)}%` : NA, pv, { spark: ser.map((x) => waterPct(x, c.thr)), idx: c.idx, delta: isNum(dW) ? `${signed(dW, 1, " pp")} vs prev${isNum(wk) ? " · ≈" + fmt(wk, 0) + " km²" : ""}` : isNum(wk) ? `≈ ${fmt(wk, 0)} km²` : "", dClass: dW > 0 ? "up" : dW < 0 ? "dn" : "" }),
      kpi("Changed area", isNum(st.percentChanged) ? `${fmt(st.percentChanged, 1)}%` : NA, pv, { spark: ser.map((x) => x.stats.percentChanged), col: COL.mg, idx: c.idx, delta: isNum(st.changedAreaKm2) ? `≈ ${fmt(st.changedAreaKm2, 0)} km² · |Δ| ≥ ${CHANGE_DB} dB` : c.prev ? "" : "first observation" }),
      kpi("Mean Δ backscatter", signed(st.meanChangeDb, 2, " dB"), pv, { spark: ser.map((x) => x.stats.meanChangeDb), col: COL.acc, idx: c.idx, delta: "pixel-wise vs prev" }),
      kpi("Mean backscatter", fmt(st.meanBackscatterDb, 2, " dB"), pv, { spark: ser.map((x) => x.stats.meanBackscatterDb), col: COL.mu, idx: c.idx, delta: isNum(dB) ? `${signed(dB, 2, " dB")} vs prev` : "" }),
      kpi("Threshold", `${minus(c.thr)} dB`, pv, { delta: "exploratory" }),
      kpi("Interval", isNum(st.intervalDays) ? `${fmt(st.intervalDays, 0)} d` : NA, pv, { delta: c.prev ? `${c.prev.date.slice(5)} → ${o.date.slice(5)}` : "" }),
      kpi("Acquisition", o.date, pv, { delta: pv === P.DEMO ? "illustrative" : o.dateSource || "" }),
      kpi("Spatial extent", isNum(st.analyzedAreaKm2) ? `${fmt(st.analyzedAreaKm2, 0)} km²` : NA, pv),
      kpi("Data maturity", o.maturity || NA, pv),
      kpi("Observations", String(ser.length), pv, { delta: `#${c.idx + 1} selected` }),
    ].join("");
  }

  function renderCharts(c) {
    const pv = c.obs ? c.obs.provenance : c.loc.provenance, demo = pv === P.DEMO, o = c.obs;
    const stamp = demo ? `<p class="cap"><span class="demo-stamp">DEMO DATA</span> · Illustrative trend — not a NASA observation</p>` : "";
    $("#ts-tag").innerHTML = tag(pv);
    const pts = (fn) => c.series.map((x) => ({ x: Date.parse(x.date), y: fn(x), id: x.id }));

    if (c.layer === "motion") {
      $("#ts-charts").innerHTML = lineChart({ series: [{ name: "mean", color: COL.vi, points: pts(meanMotion) }, { name: "max", color: COL.mu, dash: true, points: pts((x) => (isNum(x.stats.maxDisplacement) ? x.stats.maxDisplacement : x.stats.maxPhase)) }], title: "Motion per product", yLabel: demo ? "relative" : (o && (o.stats.displacementUnits || o.stats.phaseUnits)) || "", dates: true, markId: o && o.id, prov: pv, H: 200 }) + stamp + `<p class="cap">Displacement, not velocity. No uncertainty bounds are computed.</p>`;
      $("#curve-chart").innerHTML = na("Not applicable to deformation / motion products.");
    } else {
      $("#ts-charts").innerHTML =
        lineChart({ series: [{ name: "mean backscatter (dB)", color: COL.cy, points: pts((x) => x.stats.meanBackscatterDb) }], title: "Mean backscatter", yLabel: "dB", dates: true, markId: o && o.id, prov: pv, H: 130 }) +
        lineChart({ series: [{ name: `open water % @ ${c.thr} dB`, color: COL.mg, points: pts((x) => waterPct(x, c.thr)) }, { name: "changed area %", color: COL.acc, dash: true, points: pts((x) => x.stats.percentChanged) }], title: "Open water / changed area", yLabel: "%", dates: true, markId: o && o.id, prov: pv, H: 150, fill: true }) +
        stamp + `<p class="cap">σ: none computed · |Δ| &lt; 1 dB ≈ noise</p>`;
      const curve = (x) => WATER_CURVE.map((t) => ({ x: t, y: waterPct(x, t) }));
      const ser = [{ name: `after ${o.date}`, color: COL.cy, points: curve(o) }];
      if (c.before) ser.push({ name: `before ${c.before.date}`, color: COL.mu, dash: true, points: curve(c.before) });
      $("#curve-chart").innerHTML = lineChart({ series: ser, title: "Open-water % as the threshold moves", xLabel: "threshold (dB)", yLabel: "% below", vline: { x: c.thr, label: `${minus(c.thr)} dB` }, prov: pv, H: 220, fill: true }) +
        `<p class="cap">slope @ ${minus(c.thr)} dB: ${(() => { const a = waterPct(o, c.thr - 1), b = waterPct(o, c.thr + 1); return isNum(a) && isNum(b) ? fmt((b - a) / 2, 2, " pp/dB") : NA; })()}</p>`;
    }

    const hb = $("#hist-chart");
    if (c.layer === "motion") {
      const g = o && motionGrid(o);
      if (!g) hb.innerHTML = na();
      else {
        const [lo, hi] = o.stats.legendRange || [0, 1], nb = 24, counts = new Array(nb).fill(0);
        g.values.forEach((v) => { if (Number.isFinite(v)) counts[clamp(Math.floor(((v - lo) / (hi - lo || 1)) * nb), 0, nb - 1)]++; });
        const edges = Array.from({ length: nb + 1 }, (_, i) => lo + ((hi - lo) * i) / nb);
        hb.innerHTML = histChart({ edges, counts, title: "Motion value distribution", xLabel: demo ? "relative units" : o.stats.displacementUnits || o.stats.phaseUnits || "", prov: pv, colorFn: (v) => color((v - lo) / (hi - lo || 1), o.product === "GUNW" ? STOPS.div : STOPS.mag) }) + gridNote(pv);
      }
    } else {
      const h = o && o.stats.histogram;
      hb.innerHTML = !h ? na(c.prev ? NA : "First observation · no earlier date, so no change distribution.")
        : histChart({ edges: h.edgesDb, counts: h.counts, title: "Change distribution", xLabel: "Δ backscatter (dB)", prov: pv, colorFn: (v) => color((clamp(v, -6, 6) + 6) / 12, STOPS.div), marks: [-CHANGE_DB, CHANGE_DB] }) +
          `<p class="cap">${esc(c.prev.date)} → ${esc(o.date)} · ┆ ±${CHANGE_DB} dB · n=${h.counts.reduce((x, y) => x + y, 0).toLocaleString("en-US")}</p>`;
    }
    renderDensity(c, pv);
    renderTransect(c);
    renderBoxes(c, pv);
    renderCoverage(c);
  }
  /* J: 2-D histogram of before (x) vs after (y) pixel values. */
  function renderDensity(c, pv) {
    const box = $("#density-chart");
    if (c.layer === "motion") { box.innerHTML = na("Not applicable to deformation / motion products."); return; }
    const a = c.before && getGrid(c.before), b = c.obs && getGrid(c.obs);
    if (!a || !b || a.w !== b.w || a.h !== b.h) { box.innerHTML = na(c.before ? "The grids of the two dates do not match." : "Needs an earlier observation."); return; }
    const N = 70, lo = -30, hi = 5, bins = new Uint32Array(N * N);
    let n = 0;
    for (let i = 0; i < a.values.length; i++) {
      const x = a.values[i], y = b.values[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const bx = Math.floor(((x - lo) / (hi - lo)) * N), by = Math.floor(((y - lo) / (hi - lo)) * N);
      if (bx < 0 || by < 0 || bx >= N || by >= N) continue;
      bins[(N - 1 - by) * N + bx]++; n++;
    }
    let mxc = 0;
    for (let i = 0; i < bins.length; i++) if (bins[i] > mxc) mxc = bins[i];
    const mx = Math.log1p(mxc) || 1;
    const url = gridToURL(N, N, (i) => { if (!bins[i]) return null; const col = color(Math.log1p(bins[i]) / mx, STOPS.dens); return [col[0], col[1], col[2], 255]; });
    const W = 460, H = 260, m = { l: 40, r: 10, t: 20, b: 30 };
    const f = frame({ W, H, m, x0: lo, x1: hi, y0: lo, y1: hi, xLabel: `before ${c.before.date} (dB)`, yLabel: `after ${c.obs.date} (dB)`, title: `${n.toLocaleString("en-US")} pixel pairs`, prov: pv });
    const thr = c.thr;
    box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Density plot of before versus after backscatter">
      <image href="${url}" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" preserveAspectRatio="none" style="image-rendering:pixelated"/>${f.s}
      <line x1="${f.X(lo)}" y1="${f.Y(lo)}" x2="${f.X(hi)}" y2="${f.Y(hi)}" stroke="#fff" stroke-opacity=".5" stroke-dasharray="4 3"/>
      <line x1="${f.X(thr)}" x2="${f.X(thr)}" y1="${m.t}" y2="${H - m.b}" stroke="${COL.acc}" stroke-opacity=".6"/><line x1="${m.l}" x2="${W - m.r}" y1="${f.Y(thr)}" y2="${f.Y(thr)}" stroke="${COL.acc}" stroke-opacity=".6"/>
      <text x="${f.X(thr) + 4}" y="${f.Y(lo) - 6}" style="fill:${COL.mg}">new water: lower right of the lines</text></svg>
      <p class="cap">- - 1:1 · ─ threshold · log scale</p>${gridNote(pv)}`;
  }
  /* K: west-to-east profile along the selected row. */
  function renderTransect(c) {
    const box = $("#transect-chart"), o = c.obs, pv = o ? o.provenance : c.loc.provenance;
    const motion = c.layer === "motion", gFor = (x) => (x ? (motion ? motionGrid(x) : getGrid(x)) : null);
    const g = gFor(o);
    if (!g) { box.innerHTML = na(); return; }
    const b = o.bounds, lat = transectLat(b, o), km = (b[1][1] - b[0][1]) * 111.32 * Math.cos((lat * Math.PI) / 180);
    const row = clamp(Math.round(S.transect * (g.h - 1)), 0, g.h - 1);
    const line = (gg) => Array.from({ length: gg.w }, (_, i) => ({ x: (i / (gg.w - 1)) * km, y: gg.values[row * gg.w + i] })).filter((p) => isNum(p.y));
    const ser = [{ name: `after ${o.date}`, color: motion ? COL.vi : COL.cy, points: line(g), noDots: true }];
    const gb = gFor(c.before);
    if (gb && gb.w === g.w && gb.h === g.h) ser.push({ name: `before ${c.before.date}`, color: COL.mu, points: line(gb), noDots: true, dash: true });
    box.innerHTML = lineChart({ series: ser, title: `W → E profile at ${lat.toFixed(3)}°`, xLabel: "distance (km)", yLabel: motion ? (pv === P.DEMO ? "relative" : o.stats.displacementUnits || o.stats.phaseUnits || "") : "dB", prov: pv, H: 220, yPad: 0.05, vline: motion ? null : null }) +
      `<p class="cap">row ${row + 1}/${g.h} · ${fmt(km, 1, " km")}${!motion ? ` · below ${minus(c.thr)} dB: ${fmt((100 * line(g).filter((q) => q.y < c.thr).length) / (line(g).length || 1), 1, "%")}` : ""}</p>${gridNote(pv)}`;
  }
  /* L: box plots per date. */
  function renderBoxes(c, pv) {
    const box = $("#box-chart"), motion = c.layer === "motion";
    const stats = c.series.map((x) => { const g = motion ? motionGrid(x) : getGrid(x); return { o: x, q: g ? quantiles(g.values) : null }; }).filter((s) => s.q);
    if (!stats.length) { box.innerHTML = na(); return; }
    const W = 460, H = 230, m = { l: 40, r: 10, t: 20, b: 30 };
    const lo = Math.min(...stats.map((s) => s.q[0])), hi = Math.max(...stats.map((s) => s.q[4])), pad = (hi - lo) * 0.06 || 1;
    const f = frame({ W, H, m, x0: -0.5, x1: stats.length - 0.5, y0: lo - pad, y1: hi + pad, xTicks: stats.map((_, i) => i), xFmt: (i) => (stats[i] ? stats[i].o.date.slice(5) : ""), yLabel: motion ? "value" : "dB", title: "p2 · p25 · median · p75 · p98", prov: pv });
    const bw = Math.min(28, ((W - m.l - m.r) / stats.length) * 0.5);
    let s = f.s;
    if (!motion && c.thr >= lo - pad && c.thr <= hi + pad) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${f.Y(c.thr)}" y2="${f.Y(c.thr)}" stroke="${COL.acc}" stroke-dasharray="3 3"/><text x="${W - m.r}" y="${f.Y(c.thr) - 3}" text-anchor="end" style="fill:${COL.acc}">threshold</text>`;
    stats.forEach((st, i) => {
      const x = f.X(i), [a, q1, md, q3, z] = st.q, cur = c.obs && st.o.id === c.obs.id, col = cur ? COL.acc : motion ? COL.vi : COL.cy;
      s += `<g><title>${esc(st.o.date)}: median ${md.toFixed(2)}, IQR ${q1.toFixed(2)} to ${q3.toFixed(2)}</title><line x1="${x}" x2="${x}" y1="${f.Y(a)}" y2="${f.Y(z)}" stroke="${col}"/><rect x="${x - bw / 2}" y="${f.Y(q3)}" width="${bw}" height="${Math.max(1, f.Y(q1) - f.Y(q3))}" fill="${col}" fill-opacity="${cur ? 0.35 : 0.15}" stroke="${col}"/><line x1="${x - bw / 2}" x2="${x + bw / 2}" y1="${f.Y(md)}" y2="${f.Y(md)}" stroke="#fff" stroke-width="2"/></g>`;
    });
    box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Box plots of pixel values per observation date">${s}</svg><p class="cap">■ selected date · ─ median</p>${gridNote(pv)}`;
  }
  /* O: acquisition coverage strip for this location. */
  function renderCoverage(c) {
    const el = $("#coverage");
    const obs = c.loc.observations;
    const rowKey = (o) => (o.product === "DEMO" ? "DEMO" : o.product);
    const rows = [...new Set(obs.map(rowKey))];
    const t = obs.map((o) => Date.parse(o.date)).sort((a, b) => a - b), t0 = t[0], t1 = t[t.length - 1];
    const W = 460, rh = 26, H = 34 + rows.length * rh, m = { l: 60, r: 14 };
    const X = (v) => m.l + ((v - t0) / (t1 - t0 || 1)) * (W - m.l - m.r);
    let s = "";
    const d = new Date(t0);
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    for (; d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) s += `<line x1="${X(d.getTime())}" x2="${X(d.getTime())}" y1="6" y2="${H - 20}" stroke="#1c2128"/><text x="${X(d.getTime()) + 2}" y="${H - 6}">${d.toISOString().slice(0, 7)}</text>`;
    rows.forEach((r, ri) => {
      const y = 10 + ri * rh;
      s += `<text x="4" y="${y + 13}" class="ttl" style="font-size:10px">${esc(r)}</text><line x1="${m.l}" x2="${W - m.r}" y1="${y + 9}" y2="${y + 9}" stroke="#232931"/>`;
      obs.filter((o) => rowKey(o) === r).forEach((o) => {
        const cur = c.obs && o.id === c.obs.id, col = o.provenance === P.REAL ? COL.gr : COL.acc;
        s += `<rect x="${X(Date.parse(o.date)) - 3}" y="${y + 1}" width="6" height="16" fill="${cur ? "#fff" : col}"><title>${esc(o.date)} · ${esc(o.provenance)}</title></rect>`;
      });
    });
    const gaps = t.slice(1).map((v, i) => (v - t[i]) / 86400000).sort((a, b) => a - b);
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Acquisition dates for this location">${s}</svg>
      <dl class="kv" style="margin-top:8px"><dt>Observations</dt><dd>${obs.length} ${tag(c.loc.provenance)}</dd><dt>First → last</dt><dd>${esc(obs[0].date)} → ${esc(obs[obs.length - 1].date)}</dd><dt>Median revisit</dt><dd>${gaps.length ? fmt(gaps[Math.floor(gaps.length / 2)], 0, " days") : NA}</dd></dl>`;
  }

  function renderCompare(c) {
    const box = $("#compare-stats"), a = c.before, b = c.obs;
    if (!a || !b) { box.innerHTML = na(`Needs two observations. ${c.series.length < 2 ? "This layer has only one." : "Pick a later date on the timeline."}`); return; }
    const mixed = a.provenance === b.provenance ? b.provenance : "MIXED";
    const tbl = (rows) => `<table class="data"><thead><tr><th></th><th>BEFORE ${tag(a.provenance)}</th><th>AFTER ${tag(b.provenance)}</th><th>CHANGE ${tag(mixed)}</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="fa">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join("")}</tbody></table>`;
    if (c.layer === "motion") {
      const u = b.provenance === P.DEMO ? "rel." : b.stats.displacementUnits || b.stats.phaseUnits || "";
      box.innerHTML = `<div style="overflow-x:auto">${tbl([["Date", a.date, b.date, fmt(daysBetween(a.date, b.date), 0, " d")], [`Mean motion (${u})`, fmt(meanMotion(a), 3), fmt(meanMotion(b), 3), isNum(meanMotion(a)) && isNum(meanMotion(b)) ? signed(meanMotion(b) - meanMotion(a), 3) : NA]])}</div>`;
      return;
    }
    const wa = waterPct(a, c.thr), wb = waterPct(b, c.thr);
    const dMean = isNum(a.stats.meanBackscatterDb) && isNum(b.stats.meanBackscatterDb) ? b.stats.meanBackscatterDb - a.stats.meanBackscatterDb : null;
    const rel = isNum(wa) && isNum(wb) && wa > 0 ? ((wb - wa) / wa) * 100 : null;
    const rows = [["Date", a.date, b.date, fmt(daysBetween(a.date, b.date), 0, " d")],
      ["Mean backscatter", fmt(a.stats.meanBackscatterDb, 2, " dB"), fmt(b.stats.meanBackscatterDb, 2, " dB"), signed(dMean, 2, " dB")],
      ["Open-water estimate · Water-area change", fmt(wa, 1, "%"), fmt(wb, 1, "%"), isNum(wa) && isNum(wb) ? signed(wb - wa, 1, " pp") + (isNum(rel) ? ` (${signed(rel, 0, "%")})` : "") : NA]];
    if (c.bIdx === c.idx - 1) rows.push(["Δ backscatter (pixel mean)", "—", "—", signed(b.stats.meanChangeDb, 2, " dB")]);
    box.innerHTML = `<div style="overflow-x:auto">${tbl(rows)}</div><p class="cap">pp @ ${minus(c.thr)} dB</p>`;
  }
  /* N: change signals as data (template-driven, no generated prose). */
  function renderInterp(c) {
    const o = c.obs, box = $("#interp");
    if (!o) { box.innerHTML = na(); return; }
    const arrow = (v, eps) => (!isNum(v) ? "·" : v > eps ? "▲" : v < -eps ? "▼" : "▬");
    const row = (k, v, dir, flag) => `<tr><td class="fa">${esc(k)}</td><td class="num">${esc(v)}</td><td style="width:20px">${dir}</td><td>${flag || ""}</td></tr>`;
    let rows;
    if (c.layer === "motion") {
      const st = o.stats;
      rows = [row("mean", fmt(meanMotion(o), 3), "", ""), row("max", fmt(isNum(st.maxDisplacement) ? st.maxDisplacement : st.maxPhase, 3), "", ""),
        row("min", fmt(isNum(st.minDisplacement) ? st.minDisplacement : st.minPhase, 3), "", ""), row("kind", "displacement", "", '<span class="tag tag-na">NOT VELOCITY</span>')];
    } else {
      const st = o.stats, wp = waterPct(o, c.thr), wprev = c.prev ? waterPct(c.prev, c.thr) : null, dW = isNum(wp) && isNum(wprev) ? wp - wprev : null;
      const d = st.meanChangeDb;
      const sig = !isNum(d) ? "—" : d < -0.5 ? "DARKENING" : d > 0.5 ? "BRIGHTENING" : "STABLE";
      rows = [row("signal", sig, arrow(d, 0.5), ""), row("Δσ mean", signed(d, 2, " dB"), arrow(d, 0.5), ""),
        row("pixels |Δ|≥3 dB", fmt(st.percentChanged, 1, "%"), "", ""), row("open water", fmt(wp, 1, "%"), arrow(dW, 0.5), ""),
        row("Δ open water", signed(dW, 1, " pp"), arrow(dW, 0.5), ""), row("window", c.prev ? `${c.prev.date.slice(5)} → ${o.date.slice(5)}` : "first obs", "", "")];
    }
    const flags = c.layer === "motion" ? ["relative phase", "unwrapping err", "radar geometry", "downsampled"] : ["threshold not validated", "speckle", "incidence angle", "soil moisture", "vegetation", "mixed pixels", "wind roughening", "downsampled"];
    box.innerHTML = `<table class="data"><tbody>${rows.join("")}</tbody></table>
      <p class="lbl" style="margin:8px 0 4px">Uncertainty</p><div class="row" style="gap:4px">${flags.map((f) => `<span class="tag tag-na">${esc(f)}</span>`).join("")}</div>
      <p class="cap" style="margin-top:6px">${tag(o.provenance)}${o.provenance === P.DEMO ? " illustrative scenario, not a NASA observation" : " computed from file"}</p>`;
  }
  /* R: open-water % heatmap over threshold × date. */
  function renderHeat(c) {
    const box = $("#heat-chart");
    if (!box) return;
    if (c.layer === "motion" || !c.obs) { box.innerHTML = na("n/a for motion products"); return; }
    const ser = c.series, T = WATER_CURVE, W = 460, H = 240, m = { l: 44, r: 10, t: 20, b: 30 };
    const cw = (W - m.l - m.r) / ser.length, ch = (H - m.t - m.b) / T.length;
    const vals = ser.map((o) => T.map((t) => waterPct(o, t)));
    const mx = Math.max(1, ...vals.flat().filter(isNum));
    const demo = c.obs.provenance === P.DEMO;
    let s = `<text class="ttl" x="${m.l}" y="12">open water % · threshold × date</text><text x="${W - m.r}" y="12" text-anchor="end" style="fill:${demo ? "var(--demo)" : "var(--real)"};font-weight:600">${demo ? "DEMO DATA" : esc(c.obs.provenance)}</text>`;
    ser.forEach((o, i) => T.forEach((t, j) => {
      const v = vals[i][j], col = isNum(v) ? color(v / mx, STOPS.dens) : [30, 30, 30];
      s += `<rect x="${(m.l + i * cw).toFixed(1)}" y="${(H - m.b - (j + 1) * ch).toFixed(1)}" width="${(cw - 1).toFixed(1)}" height="${(ch - 0.5).toFixed(1)}" fill="rgb(${col})"><title>${esc(o.date)} @ ${t} dB: ${fmt(v, 1, "%")}</title></rect>`;
    }));
    const jt = T.indexOf(c.thr);
    if (jt >= 0) s += `<rect x="${m.l}" y="${(H - m.b - (jt + 1) * ch).toFixed(1)}" width="${W - m.l - m.r}" height="${ch.toFixed(1)}" fill="none" stroke="${COL.acc}"/>`;
    s += T.filter((t) => t % 4 === 2).map((t) => `<text x="${m.l - 4}" y="${(H - m.b - (T.indexOf(t) + 0.5) * ch + 3).toFixed(1)}" text-anchor="end">${minus(t)}</text>`).join("");
    s += ser.map((o, i) => `<text x="${(m.l + (i + 0.5) * cw).toFixed(1)}" y="${H - m.b + 12}" text-anchor="middle"${o.id === c.obs.id ? ' style="fill:#e0a526"' : ""}>${o.date.slice(5)}</text>`).join("");
    s += `<text transform="translate(9 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">threshold dB</text>`;
    box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Heatmap of open-water percentage by threshold and date">${s}</svg><p class="cap">0% → ${fmt(mx, 0, "%")} · ▭ selected threshold</p>`;
  }
  function renderRisk(c) {
    const panel = $("#risk-panel");
    panel.hidden = !c.loc.riskEnabled || c.layer === "motion";
    if (panel.hidden) return;
    const a = c.before, b = c.obs;
    const wa = a ? waterPct(a, c.thr) : null, wb = b ? waterPct(b, c.thr) : null;
    const rise = isNum(wa) && isNum(wb) && wa > 0 ? ((wb - wa) / wa) * 100 : null;
    if (S.rainfall == null) S.rainfall = b && isNum(b.simRainfallMm) ? b.simRainfallMm : 120;
    $("#risk-body").innerHTML = `<dl class="kv"><dt>Water rise ${tag(b ? b.provenance : NA)}</dt><dd>${isNum(rise) ? signed(rise, 0, "%") : NA}${a && b ? ` · ${esc(a.date.slice(5))} → ${esc(b.date.slice(5))}` : ""}</dd>
      <dt>72-h rain ${tag(P.SIM)}</dt><dd><input type="range" id="risk-rain" min="0" max="250" step="5" value="${S.rainfall}" aria-label="Simulated rainfall in millimetres"> <output id="risk-rain-out">${S.rainfall} mm</output></dd></dl>
      <div id="risk-decision" style="margin-top:8px"></div>`;
    const decide = () => {
      const res = RISK_RULES.evaluate(rise, S.rainfall);
      $("#risk-rain-out").textContent = `${S.rainfall} mm`;
      $("#risk-decision").innerHTML = `${res.level ? `<span class="risk-level risk-${res.level}" role="status">${res.level}</span>` : `<p class="na">${NA}</p>`}<pre class="rule active" style="margin-top:8px">${esc(res.rule)}</pre><p class="cap">${tag(P.SIM)} prototype rules · simulated rainfall · not a forecast</p>`;
    };
    decide();
    $("#risk-rain").addEventListener("input", (e) => { S.rainfall = Number(e.target.value); decide(); });
  }
  function renderHistory(c) {
    const rows = c.series.map((o, i) => ({ o, i })).sort((x, y) => (S.sortDesc ? -1 : 1) * (Date.parse(x.o.date) - Date.parse(y.o.date)));
    const mo = c.layer === "motion";
    $("#history").innerHTML = `<table class="data cards"><caption class="sr-only">Observation history</caption>
      <thead><tr><th scope="col" aria-sort="${S.sortDesc ? "descending" : "ascending"}"><button type="button" id="sort-date">Date ${S.sortDesc ? "▼" : "▲"}</button></th><th>Product</th><th>Status</th><th class="num">${mo ? "Mean motion" : "Mean Δ"}</th><th class="num">${mo ? "Interval" : "Changed area"}</th>${mo ? "" : '<th class="num">Open water</th><th class="num">Mean σ</th>'}</tr></thead>
      <tbody>${rows.map(({ o, i }) => `<tr class="${i === c.idx ? "current" : ""}"${i === c.idx ? ' aria-current="true"' : ""}>
        <td data-label="Date"><button type="button" class="lnk" data-idx="${i}" aria-label="Show observation ${esc(o.date)}">${esc(o.date)}</button></td>
        <td data-label="Product">${esc(o.productLabel)}</td><td data-label="Status">${tag(o.provenance)}</td>
        <td data-label="${mo ? "Mean motion" : "Mean Δ"}" class="num">${mo ? fmt(meanMotion(o), 3) : signed(o.stats.meanChangeDb, 2, " dB")}</td>
        <td data-label="${mo ? "Interval" : "Changed area"}" class="num">${mo ? fmt(o.stats.intervalDays, 0, " d") : fmt(o.stats.percentChanged, 1, "%")}</td>
        ${mo ? "" : `<td data-label="Open water" class="num">${fmt(waterPct(o, c.thr), 1, "%")}</td><td data-label="Mean σ" class="num">${fmt(o.stats.meanBackscatterDb, 2, " dB")}</td>`}</tr>`).join("")}</tbody></table>`;
    $("#sort-date").addEventListener("click", () => { S.sortDesc = !S.sortDesc; renderHistory(ctx()); $("#sort-date").focus(); });
    $$("#history [data-idx]").forEach((b) => b.addEventListener("click", () => { stopPlay(); S.index = Number(b.dataset.idx); S.beforeIdx = null; update(); }));
  }
  function renderDQ(c) {
    const o = c.obs, rows = [];
    const add = (k, v) => { if (v != null && v !== "") rows.push(`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`); };
    if (o && o.provenance === P.REAL) {
      const p = o.processing || {};
      add("Input", o.sourceFile); add("Product", `${o.product}${o.units ? " · " + o.units : ""}`); add("Dataset", p.dataset);
      add("Geolocation", p.sourceEpsg ? `xCoordinates / yCoordinates, EPSG:${p.sourceEpsg}` : null);
      add("Projection", p.sourceEpsg ? `EPSG:${p.sourceEpsg} → ${p.outputProjection}` : null);
      add("Resolution", p.nativeSpacing ? `native ${p.nativeSpacing.join(" × ")} · output ${p.outputPixels ? p.outputPixels.join(" × ") + " px" : "n/a"}` : null);
      add("Acquisition", `${o.datetime || o.date} (${o.dateSource || "file"})`); add("Granule", `${o.granule || NA} (${o.granuleSource || "file"})`);
      add("Processing", p.processedAt ? `process_nisar.py · ${p.processedAt}` : null); add("Conversion", p.conversion); add("No-data handling", p.noData);
      add("Downsampling", p.readStride ? `stride ${p.readStride} → ${p.resampling} resampling` : null);
      if (o.kinds.includes("backscatter")) add("Threshold", `${minus(c.thr)} dB (exploratory) · change |Δ| ≥ ${CHANGE_DB} dB`);
      add("Output size", p.outputBytes ? `${(p.outputBytes / 1024).toFixed(0)} KB PNG (each < 1 MB)` : null);
    } else if (o) {
      add("Input", "Synthetic field · js/locations.js (DEMO)"); add("Product", o.productLabel); add("Geolocation", "Illustrative bounding box");
      add("Projection", "Stretched over lat/lon bounds"); add("Resolution", `${DEMO_GRID.w} × ${DEMO_GRID.h} px`); add("Acquisition", `${o.date} · illustrative`);
      add("Processing", "In-browser, same rules as process_nisar.py"); add("No-data handling", "Not applicable (synthetic)");
      add("Threshold", `${minus(c.thr)} dB (exploratory) · change |Δ| ≥ ${CHANGE_DB} dB`);
    }
    const info = typeof NISAR_MANIFEST_INFO !== "undefined" ? NISAR_MANIFEST_INFO : null;
    $("#dq").innerHTML = `<p>${tag(o ? o.provenance : c.loc.provenance)} </p>
      ${pipelineSVG(PIPELINE, { highlight: o && o.provenance === P.REAL ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [6, 7, 8] })}
      <dl class="kv" style="margin-top:8px">${rows.join("") || `<dt>—</dt><dd>${NA}</dd>`}</dl>
      ${info ? `<p class="cap" style="margin-top:8px">manifest ${esc(info.generatedAt)} · found ${info.filesFound.length} · processed ${info.processed.length} · failed ${info.failed.length}${info.failed.length ? " (" + info.failed.map((x) => esc(x.file + ": " + x.reason)).join("; ") + ")" : ""}</p>` : ""}`;
  }

  /* ---------------------------------------------------------- export */
  function exportSummary() {
    const c = ctx(), o = c.obs;
    if (!o) return;
    const st = o.stats, pv = o.provenance, row = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
    const statsRows = c.layer === "motion"
      ? [row("Min", fmt(isNum(st.minDisplacement) ? st.minDisplacement : st.minPhase, 3)), row("Max", fmt(isNum(st.maxDisplacement) ? st.maxDisplacement : st.maxPhase, 3)), row("Mean", fmt(meanMotion(o), 3)), row("Units", pv === P.DEMO ? "relative, unitless (DEMO)" : st.displacementUnits || st.phaseUnits || NA), row("Interval", fmt(st.intervalDays, 0, " days"))]
      : [row("Mean backscatter", fmt(st.meanBackscatterDb, 2, " dB")), row("Mean Δ backscatter vs previous", signed(st.meanChangeDb, 2, " dB")), row("Changed area (|Δ| ≥ 3 dB)", isNum(st.percentChanged) ? `${fmt(st.percentChanged, 1)}% (≈ ${fmt(st.changedAreaKm2, 0)} km²)` : NA), row("Open-water estimate", fmt(waterPct(o, c.thr), 1, "%")), row("Open-water threshold (exploratory)", `${c.thr} dB`), row("Comparison interval", fmt(st.intervalDays, 0, " days")), row("Analyzed area", fmt(st.analyzedAreaKm2, 0, " km²"))];
    let risk = "";
    if (c.loc.riskEnabled && c.layer !== "motion") {
      const wa = c.before ? waterPct(c.before, c.thr) : null, wb = waterPct(o, c.thr);
      const r = RISK_RULES.evaluate(isNum(wa) && isNum(wb) && wa > 0 ? ((wb - wa) / wa) * 100 : null, S.rainfall);
      risk = `<h2>Risk (SIMULATED prototype)</h2><p><b>${esc(r.level || NA)}</b>. Rule: <code>${esc(r.rule)}</code><br>Rainfall of ${S.rainfall} mm is SIMULATED. This is not an operational forecast.</p>`;
    }
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>EchoSphere analysis summary — ${esc(c.loc.name)} ${esc(o.date)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#111}th{text-align:left;padding:3px 14px 3px 0;vertical-align:top;width:40%}table{border-collapse:collapse}.prov{border:2px solid #000;padding:2px 8px;font-weight:700}.warn{border-left:4px solid #c00;padding:6px 12px;background:#fee}</style></head><body>
<h1>EchoSphere analysis summary</h1><p>Team THEIA · generated ${esc(new Date().toISOString())}</p><p>Provenance: <span class="prov">${esc(pv)}</span></p>
${pv === P.DEMO ? '<p class="warn"><b>DEMO DATA.</b> Illustrative scenario, NOT a NASA or NISAR observation. Dates and values are synthetic.</p>' : ""}
<h2>Selection</h2><table>${row("Location", `${c.loc.region} · ${c.loc.name}`)}${row("Layer", LAYER_NAMES[c.layer])}${row("Product", o.productLabel)}${row("Acquisition date", o.datetime || o.date)}${row("Granule", o.granule || NA)}${row("Maturity", o.maturity || NA)}${row("Comparison", c.prev ? `${c.prev.date} → ${o.date}` : "None (first observation)")}</table>
<h2>Statistics (${esc(pv)})</h2><table>${statsRows.join("")}</table>
${c.layer !== "motion" ? '<p class="warn"><b>NOT A VALIDATED OPERATIONAL FLOOD MAP.</b> Approximate open-water detection based on a backscatter threshold; not a validated operational flood product.</p>' : ""}${risk}
<h2>Methodology</h2><p>${pv === P.REAL ? `Processed locally by process_nisar.py from ${esc(o.sourceFile)} (dataset ${esc((o.processing || {}).dataset || NA)}). Linear backscatter was reprojected to EPSG:3857 with average resampling, then converted to dB. Change is after minus before, per pixel. Pixels with |Δ| ≥ 3 dB count as changed. Open water is backscatter below the threshold.` : "Synthetic fields generated in the browser (js/locations.js). The statistics use the same rules as the real pipeline."}</p>
<h2>Uncertainty</h2><ul><li>Single-threshold water detection is approximate. Wind-roughened water, flooded vegetation and urban double-bounce can be misclassified.</li><li>Backscatter also depends on vegetation, soil moisture, viewing geometry, speckle and mixed pixels.</li><li>No validation against ground truth has been done.</li><li>Downsampling for display removes fine detail.</li></ul>
<h2>Source</h2><p>${pv === P.REAL ? `NASA-ISRO NISAR data (distributed by NASA ASF DAAC), file ${esc(o.sourceFile)}, granule ${esc(o.granule || NA)}.` : "EchoSphere DEMO scenario. No NASA/NISAR data were used for these values."}</p></body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `echosphere-summary-${c.loc.key}-${o.date}-${pv === P.DEMO ? "DEMO" : "REAL-NISAR"}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------------------------------------------------------- playback + update */
  function stopPlay() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }
  function startPlay() {
    if (ctx().series.length < 2 || S.timer) return;
    S.timer = setInterval(() => { const cc = ctx(); S.index = (cc.idx + 1) % cc.series.length; S.beforeIdx = null; update(); }, 1600);
    update();
    $("#btn-pause").focus();
  }
  function update(opts = {}) {
    const c = ctx();
    S.index = c.idx;
    renderControls(c); renderStrip(c); renderSites(c); renderLocCard(c); renderMap(c);
    if (map) { $("#legend").innerHTML = S.showOverlay ? legendHTML(c) : ""; if (opts.fit) map.fitBounds(c.loc.bounds, { padding: [20, 20] }); }
    renderMetrics(c); renderCharts(c); renderCompare(c); renderInterp(c); renderHeat(c); renderRisk(c); renderHistory(c); renderDQ(c);
  }
  function selectLocation(key) {
    stopPlay();
    S.locKey = key;
    const loc = LOCS.find((l) => l.key === key);
    S.layer = loc.layers[0];
    S.index = seriesFor(loc, S.layer).length - 1;
    S.beforeIdx = null; S.comparing = false; S.rainfall = null;
    S.showOverlay = loc.provenance === P.REAL || new URLSearchParams(location.search).get("overlay") === "1"; // live-first: DEMO overlay stays off unless requested
    $("#ov-toggle").checked = S.showOverlay;
    update({ fit: true });
    document.dispatchEvent(new CustomEvent("es:location", { detail: { key: loc.key, bounds: loc.bounds, name: loc.name, region: loc.region } }));
  }
  function initExplore() {
    LOCS = buildLocations();
    const sel = $("#loc-select");
    sel.innerHTML = LOCS.map((l) => `<option value="${esc(l.key)}">${esc(l.region.charAt(0) + l.region.slice(1).toLowerCase())} — ${esc(l.name)} (${esc(l.provenance)})</option>`).join("");
    sel.addEventListener("change", () => selectLocation(sel.value));
    initMap(); initSwipe();
    $("#time").addEventListener("input", (e) => { stopPlay(); S.index = Number(e.target.value); S.beforeIdx = null; update(); });
    $("#btn-play").addEventListener("click", startPlay);
    $("#btn-pause").addEventListener("click", () => { stopPlay(); update(); $("#btn-play").focus(); });
    $("#opacity").addEventListener("input", (e) => {
      S.opacity = Number(e.target.value) / 100;
      $("#opacity-out").textContent = `${e.target.value}%`;
      e.target.setAttribute("aria-valuetext", `${e.target.value} percent`);
      activeLayers.forEach((l) => l.setOpacity(S.opacity));
    });
    $("#thr").addEventListener("input", (e) => {
      S.threshold = Number(e.target.value);
      $("#thr-out").textContent = `${minus(e.target.value)} dB`;
      e.target.setAttribute("aria-valuetext", `${e.target.value} decibels`);
      update();
    });
    $("#transect").addEventListener("input", (e) => { S.transect = Number(e.target.value) / 100; const c = ctx(); drawTransectLine(c); renderTransect(c); });
    $("#btn-compare").addEventListener("click", () => { S.comparing = !S.comparing; update(); });
    $("#before-select").addEventListener("change", (e) => { S.beforeIdx = Number(e.target.value); update(); });
    $("#btn-export").addEventListener("click", exportSummary);
    $("#ov-toggle").addEventListener("change", (e) => { S.showOverlay = e.target.checked; update(); });
    const start = LOCS.find((l) => l.key === new URLSearchParams(location.search).get("loc")) || LOCS[0];
    sel.value = start.key;
    selectLocation(start.key);
  }

  /* Shared helpers for js/live.js (live NASA API panels). */
  window.ES = { lineChart, histChart, frame, sparkline, tag, fmt, signed, esc, isNum, clamp, color, STOPS, COL, P, NA, na, pipelineSVG, buildLocations, waterPct, waterKm2, getGrid, seriesFor, imageryFor, summarize, gridToURL, daysBetween, dataStatusText, manifest, WATER_CURVE, HIST_EDGES, DEFAULT_THRESHOLD, CHANGE_DB, getMap: () => map, currentLocation: () => (LOCS.length ? ctx().loc : null) };

  document.addEventListener("DOMContentLoaded", () => {
    initShell();
    initTabs();
    initApiMenu();
    const page = document.body.dataset.page;
    if (page === "home") initHome();
    else if (page === "explore") initExplore();
    else if (page === "bangladesh" || page === "observe") initBangladesh();
    else if (page === "about") initAbout();
  });
})();
