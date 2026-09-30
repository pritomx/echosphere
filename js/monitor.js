/* ==========================================================================
   EchoSphere · Area Selection
   One selected area drives every tab. The selection (with its imagery and
   numbers) is saved in this browser; the four examples ship pre-saved in
   data/examples.js so they open instantly.
   Browser-direct sources: NASA CMR, NASA GIBS (NISAR GCOV), NASA POWER,
   Open-Meteo, OpenStreetMap (Nominatim + Overpass).
   ========================================================================== */
(function () {
  "use strict";
  let E, U;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const dayMs = 864e5, iso = (t) => new Date(t).toISOString().slice(0, 10);
  const KEY = "es.area.v2"; // v2: examples use full-resolution processed scenes
  const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default";
  const TMS = "GoogleMapsCompatible_Level13";
  // River communities where warnings often arrive late and basic (SMS) phones are the common link
  const EXAMPLES = [
    { key: "jamuna", site: "bangladesh", name: "Jamuna River", place: "Bangladesh", phenomenon: "Char islands · bank erosion & floods", bbox: [89.45, 24.25, 89.95, 24.85] },
    { key: "kosi", site: "kosi", name: "Kosi River", place: "Bihar, India", phenomenon: "Recurrent river floods", bbox: [86.55, 25.9, 86.95, 26.3] },
    { key: "shire", site: "shire", name: "Lower Shire", place: "Malawi", phenomenon: "Cyclone and river floods", bbox: [34.9, -16.75, 35.3, -16.35] },
    { key: "beledweyne", site: "beledweyne", name: "Beledweyne", place: "Somalia", phenomenon: "Shabelle River floods", bbox: [45.05, 4.55, 45.35, 4.9] },
  ];
  const cfg = { size: 25, rise: 20, rain: 100, lum: 55, notify: false };
  const S = { bbox: null, name: "", key: null, res: null, view: "after", swipe: 50 };
  let map, rect, afterPane, beforePane, imgs = [], placeLayer;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------------------------------------------------- saved selection (shared by all tabs) */
  function readSel() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (err) { return null; } }
  function writeSel(sel) {
    try { localStorage.setItem(KEY, JSON.stringify(sel)); return true; }
    catch (err) { // storage quota: keep the numbers, drop the pictures
      try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, sel, { after: sel.after && Object.assign({}, sel.after, { img: null }), before: sel.before && Object.assign({}, sel.before, { img: null }) }))); return true; } catch (e2) { return false; }
    }
  }
  const exampleData = (key) => (typeof EXAMPLE_DATA !== "undefined" && EXAMPLE_DATA[key]) || null;
  const selection = () => { const s = readSel(); if (s && s.key && exampleData(s.key)) return exampleData(s.key); return s || exampleData("jamuna"); };
  const siteFor = (sel) => (sel && sel.key ? (EXAMPLES.find((x) => x.key === sel.key) || {}).site : null);
  function decideSel(sel, t = cfg) {
    const rise = sel && sel.after && sel.before && sel.before.water > 0 ? ((sel.after.water - sel.before.water) / sel.before.water) * 100 : null;
    const rain = sel ? sel.rain72 : null;
    if (rise == null || rain == null) return { level: null, rise, rain, rule: "Needs two passes and rainfall to evaluate." };
    if (rise > t.rise && rain > t.rain) return { level: "HIGH", rise, rain, rule: `water share rose ${rise.toFixed(0)}% > ${t.rise}%\nAND 72-h rain ${rain.toFixed(0)} mm > ${t.rain} mm\n→ HIGH` };
    if (rise > t.rise / 2 && rain > t.rain / 2) return { level: "MEDIUM", rise, rain, rule: `water share rose ${rise.toFixed(0)}% > ${t.rise / 2}%\nAND 72-h rain ${rain.toFixed(0)} mm > ${t.rain / 2} mm\n→ MEDIUM` };
    return { level: "LOW", rise, rain, rule: `water share change ${rise > 0 ? "+" : ""}${rise.toFixed(0)}% · 72-h rain ${rain.toFixed(0)} mm\nbelow the thresholds\n→ LOW` };
  }
  function baseLayer() {
    return location.protocol.startsWith("http")
      ? L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: "osm-dark", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' })
      : L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, attribution: "Basemap &copy; Esri, &copy; OpenStreetMap" });
  }

  /* Compact view of the selected area — used by the other tabs. */
  function renderPanel(el, opts = {}) {
    const sel = selection();
    if (!el || !sel) return;
    const k = (name, v, unit, sub, cls = "") => `<div class="kpi"><span class="k"><span>${name}</span></span><span class="v${v === "—" ? " na" : ""}">${v}${unit && v !== "—" ? `<small>${unit}</small>` : ""}</span><span class="d ${cls}">${sub || ""}</span></div>`;
    const d = decideSel(sel, sel.thresholds || cfg);
    const f = (v, n = 1) => (v == null || !isFinite(v) ? "—" : v.toFixed(n));
    el.innerHTML = `
      <div class="section-head" style="margin-top:0"><div><span class="eyebrow">${esc(opts.eyebrow || "Selected area")}</span><h2 class="h2" style="font-size:clamp(32px,4.4vw,52px)">${esc(sel.name)}</h2>
        <p class="mu">${sel.bbox.map((v) => v.toFixed(3)).join(", ")} · data from ${esc((sel.savedAt || "").slice(0, 10))} · <a href="monitor.html">change area →</a></p></div>
        ${d.level ? `<span class="risk-level risk-${d.level}">${d.level}</span>` : ""}</div>
      <section class="pn" style="margin-bottom:16px"><div class="kpis">
        ${k("Latest pass", sel.lastPass || "—", "", sel.passCount ? `${sel.passCount} passes` : "")}
        ${k("Water share", f(sel.after && sel.after.water), "%", sel.after ? `radar ${esc(sel.after.date)}` : "no imagery yet")}
        ${k("Change", d.rise == null ? "—" : `${d.rise > 0 ? "+" : ""}${d.rise.toFixed(0)}`, "%", sel.before ? `vs ${esc(sel.before.date)}` : "needs a second pass", d.rise > 0 ? "up" : d.rise < 0 ? "dn" : "")}
        ${k("Rain · 72 h", f(sel.rain72, 0), "mm", sel.rainEnd ? `to ${esc(sel.rainEnd)}` : "")}
        ${k("Rain · next 7 d", f(sel.fc7, 0), "mm", "forecast")}
        ${k("Next pass", sel.next || "—", "", "12-day repeat")}
      </div></section>
      ${opts.note ? `<p class="cap" style="margin:-4px 0 16px">${opts.note}</p>` : ""}
      ${opts.map === false ? "" : `<section class="pn map-card" style="margin-bottom:16px"><div style="position:relative"><div class="area-map" style="height:min(60vh,560px);min-height:380px"></div>
        <div class="map-top"><div class="seg glass area-seg"><button type="button" data-v="after" aria-pressed="true">Latest pass</button><button type="button" data-v="before" aria-pressed="false"${sel.before && sel.before.img ? "" : " disabled"}>Previous pass</button></div></div></div>
        <div class="map-bottom"><span class="cap" style="margin:0">NISAR GCOV radar${sel.after ? ` · ${esc(sel.after.date)} (${sel.after.coverage.toFixed(0)}% of area)` : ""} · ${sel.after && sel.after.processed ? "full-resolution processing" : "NASA GIBS mosaic"} · © OpenStreetMap contributors</span></div></section>`}`;
    if (opts.map === false || typeof L === "undefined") return;
    const m = L.map(el.querySelector(".area-map"), { zoomAnimation: false, zoomControl: false });
    L.control.zoom({ position: "topright" }).addTo(m);
    baseLayer().addTo(m);
    const b = [[sel.bbox[1], sel.bbox[0]], [sel.bbox[3], sel.bbox[2]]];
    L.rectangle(b, { color: "#d4b483", weight: 2, fill: false, dashArray: "6 5" }).addTo(m);
    m.fitBounds(b, { padding: [24, 24] });
    let lay = null;
    const show = (v) => {
      if (lay) m.removeLayer(lay);
      const s = v === "before" ? sel.before : sel.after;
      lay = s && s.img ? L.layerGroup([L.imageOverlay(s.img, s.bounds || b, { opacity: 0.95 })].concat(s.imgWater ? [L.imageOverlay(s.imgWater, s.bounds || b)] : [])).addTo(m) : null;
      el.querySelectorAll(".area-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === v)));
    };
    el.querySelectorAll(".area-seg button").forEach((x) => x.addEventListener("click", () => show(x.dataset.v)));
    show("after");
    if (sel.places) L.layerGroup(sel.places.map((p) => L.circleMarker([p.lat, p.lon], { radius: 4, color: "#e0b45c", weight: 1.5, fillOpacity: 0.8 }).bindTooltip(`${esc(p.name)} · ${esc(p.type)}`))).addTo(m);
  }
  window.ESArea = { get: selection, siteFor, decide: decideSel, renderPanel, examples: EXAMPLES };

  /* ---------------------------------------------------------- helpers */
  async function getJSON(url, opt) {
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const kmBox = (lat, lon, km) => { const dLat = km / 2 / 111.32, dLon = km / 2 / (111.32 * Math.cos((lat * Math.PI) / 180)); return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]; };
  const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
  const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };
  function pip(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ya, xa] = ring[i], [yb, xb] = ring[j];
      if ((ya > lat) !== (yb > lat) && lon < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) inside = !inside;
    }
    return inside;
  }
  const cover = (ring, [w, s, e, n]) => { let h = 0; for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (pip(s + ((i + 0.5) / 10) * (n - s), w + ((j + 0.5) / 10) * (e - w), ring)) h++; return h; };
  function loadTile(url) {
    return new Promise((res, rej) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => res(img); img.onerror = () => rej(new Error("tile failed")); img.src = url; });
  }
  function step(txt) {
    const li = document.createElement("li");
    li.textContent = `… ${txt}`; li.style.color = "var(--tx)";
    $("#mon-steps").appendChild(li);
    return (t2, ok = true) => { li.textContent = `${ok ? "✓" : "✕"} ${t2 || txt}`; li.style.color = ok ? "var(--mu)" : "var(--bad)"; };
  }

  /* ---------------------------------------------------------- imagery */
  async function stitch(date, bbox) {
    const [w, s, e, n] = bbox;
    const z = Math.max(6, Math.min(10, Math.round(Math.log2((1024 * 360) / ((e - w) * 256)))));
    const fx0 = lon2x(w, z), fx1 = lon2x(e, z), fy0 = lat2y(n, z), fy1 = lat2y(s, z);
    const W = Math.max(1, Math.round((fx1 - fx0) * 256)), H = Math.max(1, Math.round((fy1 - fy0) * 256));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const cx = c.getContext("2d");
    const tc = document.createElement("canvas"); tc.width = tc.height = 256;
    const tx = tc.getContext("2d", { willReadFrequently: true });
    const jobs = [];
    for (let x = Math.floor(fx0); x <= Math.floor(fx1); x++) for (let y = Math.floor(fy0); y <= Math.floor(fy1); y++) jobs.push(loadTile(`${GIBS}/${date}/${TMS}/${z}/${y}/${x}.png`).then((img) => ({ img, x, y })).catch(() => null));
    (await Promise.all(jobs)).forEach((t) => {
      if (!t) return;
      tx.clearRect(0, 0, 256, 256); tx.drawImage(t.img, 0, 0);
      const px = tx.getImageData(0, 0, 256, 256).data;
      let filled = 0, flips = 0, sat = 0;
      for (let y = 0; y < 256; y++) {
        let prev = null;
        for (let x = 0; x < 256; x++) {
          const i = (y * 256 + x) * 4, emp = px[i + 3] < 128 || px[i] + px[i + 1] + px[i + 2] < 6;
          if (!emp) { filled++; const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]); sat += mx ? (mx - mn) / mx : 0; }
          if (prev !== null && emp !== prev) flips++;
          prev = emp;
        }
      }
      // keep clean NISAR tiles only: no dithered gaps, strongly coloured false colour
      if (filled && flips / filled < 0.1 && sat / filled > 0.2) cx.drawImage(t.img, Math.round((t.x - fx0) * 256), Math.round((t.y - fy0) * 256));
    });
    const px = cx.getImageData(0, 0, W, H);
    let valid = 0;
    for (let i = 0; i < px.data.length; i += 4) if (!(px.data[i + 3] < 128 || px.data[i] + px.data[i + 1] + px.data[i + 2] < 6)) valid++;
    return { date, W, H, px, coverage: (100 * valid) / (W * H) };
  }
  /* Merge passes (newest first): each empty pixel is filled from the next older pass. */
  function mosaic(parts) {
    if (!parts.length) return null;
    const { W, H } = parts[0], c = document.createElement("canvas"); c.width = W; c.height = H;
    const cx = c.getContext("2d"), out = cx.createImageData(W, H), o = out.data;
    const used = new Set();
    let valid = 0, dark = 0;
    for (let i = 0; i < o.length; i += 4) {
      for (const p of parts) {
        const d = p.px.data;
        if (d[i + 3] < 128 || d[i] + d[i + 1] + d[i + 2] < 6) continue;
        o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2]; o[i + 3] = 255;
        used.add(p.date); valid++;
        if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < cfg.lum) dark++;
        break;
      }
    }
    cx.putImageData(out, 0, 0);
    const dates = parts.map((p) => p.date).filter((d) => used.has(d));
    return { date: dates[0], dates, img: c.toDataURL("image/webp", 0.82), coverage: (100 * valid) / (W * H), water: valid ? (100 * dark) / valid : null };
  }

  /* ---------------------------------------------------------- map (Area Selection page) */
  function initMap() {
    map = L.map("map", { zoomSnap: 0.5, zoomAnimation: false, zoomControl: false, worldCopyJump: true }).setView([24.55, 89.7], 5);
    L.control.zoom({ position: "topright" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    baseLayer().addTo(map);
    afterPane = map.createPane("monAfter"); afterPane.style.zIndex = 410;
    beforePane = map.createPane("monBefore"); beforePane.style.zIndex = 420;
    map.on("click", (e) => setArea(kmBox(e.latlng.lat, e.latlng.lng, cfg.size), `${e.latlng.lat.toFixed(3)}°, ${e.latlng.lng.toFixed(3)}°`, null, true));
    map.on("move zoom resize viewreset zoomend moveend", clip);
    initSwipe();
  }
  function setArea(bbox, name, key, keepZoom) {
    S.bbox = bbox; S.name = name; S.key = key; S.res = null;
    clearImagery();
    if (rect) map.removeLayer(rect);
    rect = L.rectangle([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { color: "#d4b483", weight: 2, fill: false, dashArray: "6 5" }).addTo(map);
    if (!keepZoom) map.fitBounds(rect.getBounds(), { padding: [30, 30] });
    $("#mon-title").textContent = name;
    $("#mon-sub").innerHTML = `${bbox.map((v) => v.toFixed(3)).join(", ")} · press <b>Load area</b> to fetch this area`;
    $("#mon-load").disabled = false; $("#mon-load").textContent = "Load area";
    $("#mon-out").hidden = true; $("#img-seg").hidden = true;
  }
  function clearImagery() { imgs.forEach((l) => map.removeLayer(l)); imgs = []; if (placeLayer) { map.removeLayer(placeLayer); placeLayer = null; } $("#map-card").classList.remove("comparing"); }

  /* ---------------------------------------------------------- loading (only on request) */
  async function load() {
    if (!S.bbox) return;
    const bbox = S.bbox, [w, s, e, n] = bbox;
    $("#mon-steps").innerHTML = "";
    $("#mon-load").disabled = true;
    clearImagery();
    const sel = { v: 1, name: S.name, bbox, key: S.key };
    let done = step("Finding NISAR passes over the area (NASA CMR)");
    let track = [];
    try {
      const j = await getJSON(`https://cmr.earthdata.nasa.gov/search/granules.json?provider=ASF&short_name=NISAR_L2_GCOV_PROVISIONAL_V1&short_name=NISAR_L2_GCOV_BETA_V1&bounding_box=${w},${s},${e},${n}&sort_key=-start_date&page_size=100`);
      const g = j.feed.entry.map((x) => {
        const t = (x.producer_granule_id || x.title).split("_");
        const v = (((x.polygons || [])[0] || [])[0] || "").trim().split(/\s+/).map(Number);
        const ring = []; for (let i = 0; i + 1 < v.length; i += 2) ring.push([v[i], v[i + 1]]);
        return { date: x.time_start.slice(0, 10), t: Date.parse(x.time_start), track: `${t[5]}${t[6]}`, cov: ring.length ? cover(ring, bbox) : 0 };
      });
      const tracks = {};
      g.filter((p) => p.cov >= 90).forEach((p) => { (tracks[p.track] = tracks[p.track] || []).push(p); });
      Object.values(tracks).forEach((a) => a.sort((x, y) => y.t - x.t));
      track = Object.values(tracks).sort((a, b) => b[0].t - a[0].t)[0] || [];
      sel.passes = g.slice(0, 60).map((p) => ({ date: p.date, cov: p.cov }));
      sel.passCount = g.length; sel.lastPass = g[0] ? g[0].date : null;
      sel.next = track[0] ? iso(track[0].t + 12 * dayMs) : null;
      done(`${g.length} NISAR passes · ${track.length} fully cover the area on the best track`);
    } catch (err) { done(`Catalog unavailable (${err.message})`, false); }
    done = step("Loading NISAR radar imagery (NASA GIBS)");
    // every pass (any track) that covers at least half the area can fill the mosaic
    const dates = [...new Set((sel.passes || []).filter((p) => p.cov >= 50).map((p) => p.date))].slice(0, 12);
    const parts = (await Promise.all(dates.map((d) => stitch(d, bbox)))).filter((r) => r.coverage > 0);
    const half = Math.max(1, Math.ceil(parts.length / 2));
    const after = mosaic(parts.slice(0, half)), before = parts.length > 1 ? mosaic(parts.slice(half)) : null;
    sel.after = after && after.coverage >= 20 ? after : null;
    sel.before = sel.after && before && before.coverage >= 20 ? before : null;
    const lbl = (x) => `${x.dates[x.dates.length - 1]}…${x.date} (${x.dates.length} pass${x.dates.length > 1 ? "es" : ""}, ${x.coverage.toFixed(0)}% of area)`;
    done(sel.after ? `Imagery mosaic: ${[sel.after, sel.before].filter(Boolean).map(lbl).join(" vs ")}` : "No NISAR imagery covering this area yet", !!sel.after);
    done = step("Loading rainfall (NASA POWER) and forecast (Open-Meteo)");
    const lat = (s + n) / 2, lon = (w + e) / 2;
    try {
      const end = new Date(Date.now() - dayMs), start = new Date(end.getTime() - 45 * dayMs), f = (d) => iso(d).replace(/-/g, "");
      const [pw, om] = await Promise.all([
        getJSON(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&start=${f(start)}&end=${f(end)}&format=JSON`),
        getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=precipitation_sum&forecast_days=16&timezone=UTC`),
      ]);
      const v = pw.properties.parameter.PRECTOTCORR;
      sel.obs = Object.keys(v).sort().map((k) => ({ date: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6)}`, mm: v[k] > -900 ? v[k] : null }));
      sel.fc = om.daily.time.map((t, i) => ({ date: t, mm: om.daily.precipitation_sum[i] }));
      const ok = sel.obs.filter((r) => r.mm != null);
      sel.rain72 = ok.slice(-3).reduce((a, r) => a + r.mm, 0);
      sel.rainEnd = ok.length ? ok[ok.length - 1].date : null;
      sel.fc7 = sel.fc.slice(0, 7).reduce((a, r) => a + (r.mm || 0), 0);
      done(`Rain ${sel.rain72.toFixed(0)} mm in 72 h · ${sel.fc7.toFixed(0)} mm forecast for 7 days`);
    } catch (err) { done(`Rainfall unavailable (${err.message})`, false); }
    done = step("Finding places (OpenStreetMap)");
    try {
      const q = `[out:json][timeout:25];node["place"~"city|town|village|hamlet"](${s},${w},${n},${e});out 200;`;
      const j = await getJSON("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      sel.places = j.elements.filter((x) => x.tags && x.tags.name).map((x) => ({ name: x.tags["name:en"] || x.tags.name, local: x.tags.name, type: x.tags.place, lat: +x.lat.toFixed(5), lon: +x.lon.toFixed(5) }));
      done(`${sel.places.length} named places`);
    } catch (err) { sel.places = []; done(`Places unavailable (${err.message})`, false); }
    sel.thresholds = { rise: cfg.rise, rain: cfg.rain };
    sel.savedAt = new Date().toISOString();
    S.res = sel;
    const saved = writeSel(sel);
    step(saved ? "Saved — every tab now shows this area" : "Could not save in this browser")(null, saved);
    if (U.refreshArea) U.refreshArea();
    showImagery(); render();
    $("#mon-load").disabled = false; $("#mon-load").textContent = "Refresh from NASA";
    window.__lastArea = sel; // read by the example builder script
  }
  function useSaved(sel) {
    setArea(sel.bbox, sel.name, sel.key || null);
    S.res = sel;
    writeSel(sel);
    $("#mon-steps").innerHTML = "";
    step(`Saved data from ${(sel.savedAt || "").slice(0, 10)} — every tab now shows this area`)(null, true);
    if (U.refreshArea) U.refreshArea();
    $("#mon-load").textContent = "Refresh from NASA";
    showImagery(); render();
  }

  /* ---------------------------------------------------------- display */
  let lumT = null;
  function showImagery() {
    clearImagery();
    const r = S.res;
    if (!r || !r.after || !r.after.img) return;
    const b = [[r.bbox[1], r.bbox[0]], [r.bbox[3], r.bbox[2]]], op = Number($("#mon-op").value) / 100;
    const add = (shot, pane) => {
      imgs.push(L.imageOverlay(shot.img, shot.bounds || b, { pane, opacity: op, interactive: false }).addTo(map));
      if (shot.imgWater && cfg.lum === 55) imgs.push(L.imageOverlay(shot.imgWater, shot.bounds || b, { pane, opacity: 1, interactive: false }).addTo(map));
      else lumWater(shot, (u) => { if (u && S.res && (S.res.after === shot || S.res.before === shot)) imgs.push(L.imageOverlay(u, shot.bounds || b, { pane, opacity: 1, interactive: false }).addTo(map)); });
    };
    $("#img-seg").hidden = false;
    const hasB = !!(r.before && r.before.img);
    $$("#img-seg button").forEach((x) => { x.setAttribute("aria-pressed", String(x.dataset.v === S.view)); if (x.dataset.v !== "after") x.disabled = !hasB; });
    if (S.view === "before" && hasB) add(r.before, "monAfter");
    else if (S.view === "swipe" && hasB) { add(r.after, "monAfter"); add(r.before, "monBefore"); $("#swipe-before").textContent = `BEFORE ${r.before.date}`; $("#swipe-after").textContent = `AFTER ${r.after.date}`; }
    else add(r.after, "monAfter");
    $("#map-card").classList.toggle("comparing", S.view === "swipe" && hasB);
    $("#map-note").textContent = `NISAR GCOV radar · ${r.after.date}${r.before ? ` vs ${r.before.date}` : ""} · ${r.after.processed ? "full-resolution processing" : "NASA GIBS"} · ${r.after.coverage.toFixed(0)}% of area · basemap © OpenStreetMap contributors`;
    if (r.places) placeLayer = L.layerGroup(r.places.map((p) => L.circleMarker([p.lat, p.lon], { radius: p.type === "city" || p.type === "town" ? 6 : 4, color: "#e0b45c", weight: 1.5, fillOpacity: 0.8 }).bindTooltip(`${esc(p.name)} · ${esc(p.type)}`))).addTo(map);
    clip();
  }
  /* Water layer from the radar image: pixels darker than the cutoff (the "Water cutoff" slider). */
  function lumWater(shot, cb) {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const cx = c.getContext("2d"); cx.drawImage(im, 0, 0);
      let px; try { px = cx.getImageData(0, 0, c.width, c.height); } catch (e) { return cb(null); }
      const d = px.data; let valid = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128 || d[i] + d[i + 1] + d[i + 2] < 6) { d[i + 3] = 0; continue; }
        valid++;
        if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < cfg.lum) { d[i] = 110; d[i + 1] = 195; d[i + 2] = 212; d[i + 3] = 230; dark++; } else d[i + 3] = 0;
      }
      cx.putImageData(px, 0, 0);
      if (valid && shot === (S.res && S.res.after)) { const n = $("#map-note"); if (n) n.dataset.water = ((100 * dark) / valid).toFixed(1); }
      cb(c.toDataURL());
    };
    im.onerror = () => cb(null);
    im.src = shot.img;
  }
  function clip() {
    if (!map) return;
    if (!$("#map-card").classList.contains("comparing")) { afterPane.style.clip = ""; beforePane.style.clip = ""; return; }
    const size = map.getSize(), x = Math.round((size.x * S.swipe) / 100);
    const nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
    beforePane.style.clip = `rect(${nw.y}px, ${nw.x + x}px, ${se.y}px, ${nw.x}px)`;
    afterPane.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${nw.x + x}px)`;
    const h = $("#swipe"); h.style.left = `${x}px`; h.style.height = `${size.y}px`;
  }
  function initSwipe() {
    const h = $("#swipe"); let drag = false;
    const setX = (cx) => { const r = $("#map").getBoundingClientRect(); S.swipe = Math.max(2, Math.min(98, ((cx - r.left) / r.width) * 100)); clip(); };
    h.addEventListener("pointerdown", (e) => { drag = true; h.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
    h.addEventListener("pointermove", (e) => { if (drag) setX(e.clientX); });
    h.addEventListener("pointerup", () => { drag = false; });
    h.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") S.swipe = Math.max(2, S.swipe - 2); else if (e.key === "ArrowRight") S.swipe = Math.min(98, S.swipe + 2); else return; e.preventDefault(); clip(); });
  }

  function render() {
    const r = S.res;
    if (!r) return;
    $("#mon-out").hidden = false;
    const d = decideSel(r, cfg), a = r.after, b = r.before;
    const k = (name, v, unit, sub, cls = "") => `<div class="kpi"><span class="k"><span>${name}</span></span><span class="v${v === E.NA ? " na" : ""}">${E.esc(v)}${unit && v !== E.NA ? `<small>${unit}</small>` : ""}</span><span class="d ${cls}">${sub || ""}</span></div>`;
    $("#mon-kpis").innerHTML =
      k("Latest pass", r.lastPass || E.NA, "", r.passCount ? `${r.passCount} passes found` : "") +
      k("Water share", a && E.isNum(a.water) ? a.water.toFixed(1) : E.NA, a ? "%" : "", a ? `radar image ${E.esc(a.date)}` : "no imagery yet") +
      k("Change", E.isNum(d.rise) ? E.signed(d.rise, 0) : E.NA, E.isNum(d.rise) ? "%" : "", b ? `vs ${E.esc(b.date)}` : "needs a second pass", d.rise > 0 ? "up" : d.rise < 0 ? "dn" : "") +
      k("Rain · 72 h", E.isNum(r.rain72) ? r.rain72.toFixed(0) : E.NA, E.isNum(r.rain72) ? "mm" : "", r.rainEnd ? `to ${r.rainEnd}` : "") +
      k("Rain · next 7 d", E.isNum(r.fc7) ? r.fc7.toFixed(0) : E.NA, E.isNum(r.fc7) ? "mm" : "", "forecast") +
      k("Next pass", r.next || E.NA, "", r.next ? "same track, 12-day repeat" : "");
    $("#mon-dec-tag").innerHTML = E.tag(E.P.REAL);
    $("#mon-dec").innerHTML = `${d.level ? `<span class="risk-level risk-${d.level}" role="status">${d.level}</span>` : `<p class="na">${E.NA}</p>`}<pre class="rule active" style="margin-top:14px">${E.esc(d.rule)}</pre>
      <p class="cap">HIGH when water share rises more than ${cfg.rise}% and 72-h rain exceeds ${cfg.rain} mm (MEDIUM at half of each).</p>`;
    if (r.obs && r.fc) {
      $("#mon-rain").innerHTML = E.lineChart({ series: [
        { name: "observed mm/day", color: "#5b8fd1", noDots: true, points: r.obs.map((x) => ({ x: Date.parse(x.date), y: x.mm })) },
        { name: "forecast mm/day", color: "#6ec3d4", points: r.fc.map((x) => ({ x: Date.parse(x.date), y: x.mm })) },
      ], title: "", yLabel: "mm / day", dates: true, H: 240, W: 720, fill: true, vline: { x: Date.parse(iso(Date.now())), label: "today" } });
    } else $("#mon-rain").innerHTML = E.na("Rainfall unavailable.");
    const ps = (r.passes || []).slice(0, 40);
    if (ps.length) {
      const ts = ps.map((p) => Date.parse(p.date)), t0 = Math.min(...ts), t1 = Date.now() + 14 * dayMs, W = 520, H = 120, X = (t) => 10 + ((t - t0) / (t1 - t0)) * (W - 20);
      let sv = `<line x1="10" x2="${W - 10}" y1="60" y2="60" stroke="#34343c"/>`;
      ps.forEach((p) => { sv += `<rect x="${X(Date.parse(p.date)) - 2}" y="${p.cov >= 90 ? 44 : 52}" width="4" height="${p.cov >= 90 ? 32 : 16}" rx="2" fill="${p.cov >= 90 ? "#d4b483" : "#6c6b66"}"><title>${p.date} · ${p.cov}% of area</title></rect>`; });
      if (r.next) sv += `<rect x="${X(Date.parse(r.next)) - 3}" y="40" width="6" height="40" rx="2" fill="none" stroke="#6ec3d4" stroke-width="2"><title>next ${r.next}</title></rect>`;
      sv += `<text x="10" y="100">${iso(t0)}</text><text x="${W - 10}" y="100" text-anchor="end">${iso(t1)}</text>`;
      $("#mon-passes").innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="NISAR passes over the area">${sv}</svg><div class="leg"><span><i style="background:#d4b483"></i>full coverage</span><span><i style="background:#6c6b66"></i>partial</span><span><i style="background:#6ec3d4"></i>next pass</span></div>`;
    } else $("#mon-passes").innerHTML = E.na("No NISAR passes found over this area yet.");
    const order = { city: 0, town: 1, village: 2, hamlet: 3 };
    $("#mon-places-n").textContent = r.places ? `${r.places.length} named places` : "";
    $("#mon-places").innerHTML = r.places && r.places.length ? `<table class="data"><thead><tr><th>Place</th><th>Type</th><th class="num">Lat, Lon</th></tr></thead><tbody>${r.places.slice().sort((x, y) => (order[x.type] - order[y.type]) || x.name.localeCompare(y.name)).slice(0, 150).map((p) => `<tr><td><b>${E.esc(p.name)}</b>${p.local !== p.name ? ` <span class="fa">${E.esc(p.local)}</span>` : ""}</td><td class="fa">${E.esc(p.type)}</td><td class="num">${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}</td></tr>`).join("")}</tbody></table>` : E.na("No named places in this area.");
    U.setStatus({ mode: "current", risk: d.level });
    if (d.level === "HIGH") {
      U.showAlert(`HIGH — ${r.name}`, `Water share ${E.signed(d.rise, 0, "%")} with ${d.rain.toFixed(0)} mm of rain in 72 h crossed your thresholds.`, "CURRENT");
      if (cfg.notify && "Notification" in window && Notification.permission === "granted") new Notification(`EchoSphere: HIGH — ${r.name}`, { body: `water ${E.signed(d.rise, 0, "%")}, rain ${d.rain.toFixed(0)} mm/72 h` });
    } else U.hideAlert(false);
  }

  /* ---------------------------------------------------------- controls */
  function initControls() {
    $("#mon-examples").innerHTML = EXAMPLES.map((x, i) => `<button class="btn btn-sm" type="button" data-ex="${i}">${E.esc(x.name)}</button>`).join("");
    $$("#mon-examples [data-ex]").forEach((b) => b.addEventListener("click", () => {
      const x = EXAMPLES[b.dataset.ex], saved = exampleData(x.key);
      if (saved) useSaved(saved); else { setArea(x.bbox, `${x.name}, ${x.place}`, x.key); load(); }
    }));
    const search = async () => {
      const q = $("#mon-q").value.trim(), ul = $("#mon-results");
      if (!q) return;
      ul.innerHTML = `<li class="cap">searching…</li>`;
      try {
        const res = await getJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`);
        ul.innerHTML = res.length ? res.map((r, i) => `<li><button class="btn btn-sm" type="button" data-r="${i}" style="width:100%;justify-content:flex-start;margin-top:4px;white-space:normal;text-align:left;min-height:34px">${E.esc(r.display_name.split(",").slice(0, 3).join(","))}</button></li>`).join("") : `<li class="cap">No match.</li>`;
        $$("#mon-results [data-r]").forEach((b) => b.addEventListener("click", () => { const r = res[b.dataset.r]; setArea(kmBox(Number(r.lat), Number(r.lon), cfg.size), r.display_name.split(",")[0], null); ul.innerHTML = ""; }));
      } catch (err) { ul.innerHTML = `<li class="cap">Search unavailable (${E.esc(err.message)})</li>`; }
    };
    $("#mon-search").addEventListener("click", search);
    $("#mon-q").addEventListener("keydown", (e) => { if (e.key === "Enter") search(); });
    $("#mon-size").addEventListener("input", (e) => {
      cfg.size = Number(e.target.value); $("#mon-size-out").textContent = `${cfg.size} km`;
      if (S.bbox && !S.key) { const c = [(S.bbox[1] + S.bbox[3]) / 2, (S.bbox[0] + S.bbox[2]) / 2]; setArea(kmBox(c[0], c[1], cfg.size), S.name, null, true); }
    });
    const bind = (id, key, fmtv) => $(id).addEventListener("input", (e) => { cfg[key] = Number(e.target.value); $(id + "-out").textContent = fmtv(cfg[key]); if (S.res) { S.res.thresholds = { rise: cfg.rise, rain: cfg.rain }; writeSel(S.res); render(); } });
    if ($("#t-rise")) bind("#t-rise", "rise", (v) => `${v}%`);
    if ($("#t-rain")) bind("#t-rain", "rain", (v) => `${v} mm`);
    if ($("#t-lum")) $("#t-lum").addEventListener("input", (e) => { cfg.lum = Number(e.target.value); $("#t-lum-out").textContent = String(cfg.lum); clearTimeout(lumT); lumT = setTimeout(showImagery, 120); });
    if ($("#t-notify")) $("#t-notify").addEventListener("change", async (e) => { cfg.notify = e.target.checked; if (cfg.notify && "Notification" in window && Notification.permission === "default") await Notification.requestPermission(); });
    $("#mon-load").addEventListener("click", load);
    $("#mon-op").addEventListener("input", (e) => imgs.forEach((l) => l.setOpacity(Number(e.target.value) / 100)));
    $$("#img-seg button").forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.v; showImagery(); }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (document.body.dataset.page !== "monitor") return;
    E = window.ES; U = window.ESUI;
    if (!E || !U || typeof L === "undefined") return;
    initMap(); initControls();
    const sel = readSel();
    if (sel) {
      if (sel.thresholds && $("#t-rise")) { cfg.rise = sel.thresholds.rise; cfg.rain = sel.thresholds.rain; $("#t-rise").value = cfg.rise; $("#t-rain").value = cfg.rain; $("#t-rise-out").textContent = `${cfg.rise}%`; $("#t-rain-out").textContent = `${cfg.rain} mm`; }
      useSaved(sel);
    }
  });
})();
