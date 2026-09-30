/* ==========================================================================
   EchoSphere — page controllers for the three-step story
   Home (story) → Observe (real NISAR map + 4 charts) → Act (Bangladesh warning)
   Uses the shared data model and chart helpers exposed by app.js (window.ES).
   ========================================================================== */
(function () {
  "use strict";
  let E;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const dayMs = 864e5;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);

  const siteName = (l) => ({ BANGLADESH: "Jamuna" }[l.region] || l.name);
  const bsObs = (l) => l.observations.filter((o) => o.kinds.includes("backscatter"));

  /* Radar (grey backscatter) image for an observation: the processed PNG for REAL, rendered grid for DEMO. */
  function radarURL(o) {
    if (o.overlays && o.overlays.backscatter) return o.overlays.backscatter;
    const g = E.getGrid(o);
    if (!g) return null;
    if (!o._radar) o._radar = E.gridToURL(g.w, g.h, (i) => { const v = g.values[i]; if (!Number.isFinite(v)) return null; const c = E.color((v + 25) / 25, E.STOPS.gray); return [c[0], c[1], c[2], 255]; });
    return o._radar;
  }

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }


  /* ---------------------------------------------------------- fixed status bar + simulation alert (all pages) */
  const STATUS = { mode: "current" };
  function initStatusBar() {
    const bar = document.createElement("div");
    bar.className = "statusbar"; bar.id = "statusbar"; bar.setAttribute("role", "status"); bar.setAttribute("aria-label", "System status");
    document.body.appendChild(bar);
    const al = document.createElement("div");
    al.className = "alert"; al.id = "sim-alert"; al.hidden = true; al.setAttribute("role", "alert");
    al.innerHTML = `<div class="siren" aria-hidden="true">!</div><div><h4 id="sim-alert-h"></h4><p id="sim-alert-p"></p></div><button class="x" type="button" aria-label="Dismiss simulated alert">✕</button>`;
    document.body.appendChild(al);
    al.querySelector(".x").addEventListener("click", () => hideAlert(true));
    renderStatus();
    renderAreaChip();
  }
  function renderStatus() {
    const bar = $("#statusbar");
    if (!bar) return;
    const X = typeof EROSION !== "undefined" ? EROSION : null, m = E.manifest();
    const latest = m.map((r) => r.date).sort().pop();
    const area = window.ESArea && window.ESArea.get(), jam = !area || area.key === "jamuna";
    const flagged = STATUS.flagged != null ? STATUS.flagged : jam && X ? X.settlements.flagged : null;
    const sim = STATUS.mode === "simulate";
    const it = (k, v, cls = "") => `<div class="it ${cls}"><span class="k">${k}</span><b>${v}</b></div>`;
    // every figure follows the selected area (Jamuna uses its full analysis)
    const aLatest = !jam && area ? area.lastPass || (area.after && area.after.date) : latest;
    const aNext = !jam && area && area.next ? area.next : aLatest ? new Date(Date.parse(aLatest) + 12 * dayMs).toISOString().slice(0, 10) : null;
    const w0 = !jam && area && area.before && E.isNum(area.before.water) ? area.before.water : null, w1 = !jam && area && area.after && E.isNum(area.after.water) ? area.after.water : null;
    const waterTxt = jam ? (X ? `${X.water.beforePct.toFixed(1)}→${X.water.afterPct.toFixed(1)}%` : null) : E.isNum(w1) ? (E.isNum(w0) ? `${w0.toFixed(1)}→${w1.toFixed(1)}%` : `${w1.toFixed(1)}%`) : null;
    bar.innerHTML =
      (area ? it("Area", E.esc(area.name)) : "") +
      it("Mode", sim ? "● SIMULATION" : "● CURRENT STATE", sim ? "mode-sim" : "") +
      it("Data", jam ? (m.length ? `NISAR · ${m.length} scenes` : "sample") : `NISAR · ${area.passCount ? area.passCount + " passes" : area.after ? (area.after.processed ? "processed" : "GIBS mosaic") : "no imagery"}`) +
      it("Latest pass", aLatest || "—") +
      it("Next pass", aNext ? aNext + " (predicted)" : "—") +
      (waterTxt ? it("Water", waterTxt) : "") +
      (flagged != null ? it(sim ? (jam ? "Flagged (sim)" : "Reached (sim)") : "Flagged villages", String(flagged), flagged > 0 ? "flag-on" : "") : "") +
      (STATUS.risk ? it(sim ? "Risk (sim)" : "Risk", STATUS.risk, STATUS.risk === "HIGH" ? "flag-on" : "") : "") +
      it("Sources", "NASA ASF · CMR · POWER · OSM", "end");
  }
  function setStatus(p) { Object.assign(STATUS, p); renderStatus(); }
  /* Header preview of the selected area: thumbnail · name · water · risk. */
  function renderAreaChip() {
    const top = $(".topbar"), area = window.ESArea && window.ESArea.get();
    if (!top || !area) return;
    let chip = $("#areachip");
    if (!chip) { chip = document.createElement("a"); chip.id = "areachip"; chip.className = "areachip"; chip.href = "monitor.html"; top.insertBefore(chip, $(".sysline")); }
    const d = window.ESArea.decide(area, area.thresholds || { rise: 20, rain: 100 });
    const w = area.after && E.isNum(area.after.water) ? `${area.after.water.toFixed(1)}% water` : "no imagery";
    chip.title = `Selected area: ${area.name} — change area`;
    chip.innerHTML = `${area.after && area.after.img ? `<img src="${E.esc(area.after.img)}" alt="">` : ""}<span><b>${E.esc(area.name)}</b><small>${w}${area.after ? ` · ${E.esc(area.after.date)}` : ""}</small></span>${d.level ? `<span class="chiprisk risk-${d.level}">${d.level}</span>` : ""}`;
  }
  let alertDismissed = false;
  function showAlert(title, msg, label = "SIMULATED") {
    const al = $("#sim-alert");
    if (!al || alertDismissed) return;
    $("#sim-alert-h").textContent = title;
    $("#sim-alert-p").innerHTML = `${E.esc(msg)} <span class="tag ${label === "SIMULATED" ? "tag-sim" : "tag-real"}" style="margin-left:6px">${E.esc(label)}</span>`;
    al.hidden = false;
    document.body.classList.add("danger");
  }
  function hideAlert(byUser) {
    const al = $("#sim-alert");
    if (!al) return;
    al.hidden = true;
    document.body.classList.remove("danger");
    if (byUser) alertDismissed = true;
  }
  function resetAlert() { alertDismissed = false; hideAlert(false); }
  window.ESUI = { showAlert: (...a) => showAlert(...a), hideAlert: (...a) => hideAlert(...a), resetAlert: () => resetAlert(), setStatus: (p) => setStatus(p), refreshArea: () => { renderStatus(); renderAreaChip(); } };

  /* Show the selected area instead of a page's site-specific content. */
  function showAreaInstead(note, map = true) {
    const main = $("#main");
    Array.from(main.children).forEach((c) => { if (!c.hasAttribute("data-keep")) c.remove(); }); // no duplicate controls left behind
    const box = document.createElement("div");
    box.id = "area-view";
    main.prepend(box);
    const keep = main.querySelector("[data-keep]"); if (keep) main.appendChild(keep);
    window.ESArea.renderPanel(box, { note, map });
  }

  /* ======================================================================
     HOME
     ====================================================================== */
  function initLanding() {
    const locs = E.buildLocations();
    const nReal = E.manifest().length;
    const hero = locs.find((l) => l.key === "bangladesh") || locs[0];
    const ho = bsObs(hero).slice(-1)[0];
    $("#hero-img").src = radarURL(ho) || "";
    $("#hero-img").alt = `NISAR radar backscatter of the ${hero.name}, ${ho.date}`;
    $("#hero-cap").innerHTML = `<span>${E.esc(hero.name)} · ${E.esc(ho.date)}</span>${E.tag(ho.provenance)}`;
    const wp = E.waterPct(ho, E.DEFAULT_THRESHOLD);
    $("#hero-stats").innerHTML = `
      <div><b>${nReal}</b><span>NISAR scenes processed</span></div>
      <div><b>${locs.filter((l) => l.provenance === E.P.REAL).length}<small style="font-size:18px;color:var(--fa)"> / ${locs.length}</small></b><span>sites on real data</span></div>
      <div><b>${E.fmt(wp, 1)}<small style="font-size:18px;color:var(--fa)">%</small></b><span>Jamuna open water, ${E.esc(ho.date)}</span></div>`;
    $("#data-status").textContent = E.dataStatusText();
    $("#sites").innerHTML = locs.map((l) => {
      const o = bsObs(l).slice(-1)[0] || l.observations.slice(-1)[0];
      return `<a class="site" href="explore.html?loc=${encodeURIComponent(l.key)}"><div class="img" style="background-image:url('${radarURL(o) || ""}')" role="img" aria-label="Radar image of ${E.esc(l.name)}"></div>
        <div class="meta"><div><b>${E.esc(siteName(l))}</b><span>${E.esc(l.phenomenon)}</span></div>${E.tag(l.provenance)}</div></a>`;
    }).join("");
  }

  /* ======================================================================
     OBSERVE
     ====================================================================== */
  const S = { key: "bangladesh", layer: "water", idx: 0, thr: -18, compare: false, swipe: 50, opacity: 0.9, mode: "current", simX: 0, simThr: null };
  let LOCS = [], map = null, afterPane, beforePane, layers = [], legendCtl;

  const loc = () => LOCS.find((l) => l.key === S.key) || LOCS[0];
  const series = () => bsObs(loc());
  const cur = () => series()[S.idx] || null;
  const prev = () => (S.idx > 0 ? series()[S.idx - 1] : null);

  function initObserve() {
    LOCS = E.buildLocations();
    const want = new URLSearchParams(location.search).get("loc");
    const area = window.ESArea && window.ESArea.get(), areaSite = area && window.ESArea.siteFor(area);
    if (LOCS.some((l) => l.key === want)) S.key = want;
    else if (areaSite && LOCS.some((l) => l.key === areaSite)) S.key = areaSite;
    else if (area) { showAreaInstead("Full radar processing (backscatter in dB, change maps) is available for the four example areas; this view uses the NISAR imagery loaded for your area.", false); areaFloodSim(area); return; }
    // site switcher
    $("#site-seg").innerHTML = LOCS.map((l) => `<button type="button" data-key="${E.esc(l.key)}" aria-pressed="${l.key === S.key}">${E.esc(siteName(l))} <span class="fa" style="font-size:10px">${l.provenance === E.P.REAL ? "●" : "◆"}</span></button>`).join("");
    $$("#site-seg button").forEach((b) => b.addEventListener("click", () => { S.key = b.dataset.key; S.idx = series().length - 1; S.compare = false; history.replaceState(null, "", `?loc=${S.key}`); render({ fit: true }); }));
    $$("#layer-seg button").forEach((b) => b.addEventListener("click", () => { S.layer = b.dataset.layer; render(); }));
    if ($("#thr")) $("#thr").addEventListener("input", (e) => { S.thr = Number(e.target.value); $("#thr-out").textContent = `${String(S.thr).replace("-", "−")} dB`; render(); });
    $("#opacity").addEventListener("input", (e) => { S.opacity = Number(e.target.value) / 100; layers.forEach((l) => l.setOpacity(S.opacity)); });
    $("#btn-compare").addEventListener("click", () => { S.compare = !S.compare; render(); });
    if ($("#obs-sms")) obsSms = smsPhone($("#obs-sms"));
    $$("#obs-mode button").forEach((b) => b.addEventListener("click", () => {
      S.mode = b.dataset.mode;
      if (obsSms && b.dataset.mode === "current") obsSms(null);
      $$("#obs-mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if ($("#obs-sim")) $("#obs-sim").hidden = S.mode !== "simulate";
      S.simX = S.mode === "simulate" && $("#rule-water") ? Number($("#rule-water").value) : 0;
      resetAlert(); setStatus({ mode: S.mode }); render();
    }));
    // the flood simulator's water-rise slider grows the water on the map
    if ($("#rule-water")) $("#rule-water").addEventListener("input", (e) => { if (S.mode !== "simulate") return; S.simX = Number(e.target.value); render(); });
    $("#btn-export").addEventListener("click", exportSummary);
    initMap();
    initSwipe();
    S.idx = series().length - 1;
    render({ fit: true });
  }

  function initMap() {
    if (typeof L === "undefined") { $("#map").innerHTML = '<div class="map-empty">Map library could not load (offline). Charts still work.</div>'; return; }
    // zoomAnimation off: keeps the before/after clip and image overlays stable while zooming (no glitch frames).
    map = L.map("map", { zoomSnap: 0.5, zoomAnimation: false, minZoom: 6, maxZoom: 13, worldCopyJump: false, zoomControl: false });
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap", maxZoom: 16 }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, pane: "shadowPane", opacity: 0.8 }).addTo(map);
    afterPane = map.createPane("afterPane"); afterPane.style.zIndex = 410;
    beforePane = map.createPane("beforePane"); beforePane.style.zIndex = 420;
    legendCtl = L.control({ position: "bottomright" });
    legendCtl.onAdd = () => { const d = L.DomUtil.create("div", "legend"); d.id = "legend"; L.DomEvent.disableClickPropagation(d); return d; };
    legendCtl.addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    map.on("move zoom resize viewreset zoomend moveend", applyClip);
  }

  function imagesFor(o, p, layer) {
    if (!o) return [];
    if (layer === "radar") return [radarURL(o)].filter(Boolean);
    if (layer === "change") return E.imageryFor(o, p, "change", S.thr).urls;
    return E.imageryFor(o, p, "flood", S.thr).urls;
  }
  function drawMap(fit) {
    if (!map) return;
    layers.forEach((l) => map.removeLayer(l));
    layers = [];
    const o = cur(), p = prev(), add = (urls, b, pane) => urls.forEach((u) => { const l = L.imageOverlay(u, b, { pane, opacity: S.opacity, interactive: false }); l.addTo(map); layers.push(l); });
    const layer = S.layer === "change" && !p ? "water" : S.layer;
    if (S.mode === "simulate" && S.simX && layer === "water" && o) {
      const g = E.getGrid(o);
      if (g) {
        const url = E.gridToURL(g.w, g.h, (i) => { const v = g.values[i]; if (!Number.isFinite(v) || v >= S.thr) return null; return v < S.baseForSim ? [110, 195, 212, 225] : [229, 143, 180, 245]; });
        if (o.overlays && o.overlays.backscatter) add([o.overlays.backscatter], o.bounds, "afterPane");
        add([url], o.bounds, "afterPane");
        $("#legend").innerHTML = `<h4>Flood scenario <span class="tag tag-sim">SIM</span></h4><ul><li><span class="sw" style="background:#6ec3d4"></span>Water observed</li><li><span class="sw" style="background:#e58fb4"></span>Newly flooded (scenario)</li></ul>`;
        if (fit) { const b = L.latLngBounds(o.bounds); map.setMaxBounds(b.pad(1.2)); map.fitBounds(b, { padding: [24, 24] }); }
        applyClip();
        return;
      }
    }
    // real scenes: water map recomputed from the radar PNG (grey = −25…0 dB) so the threshold and scenario redraw it
    if (layer === "water" && !S.compare && o && !E.getGrid(o) && o.overlays && o.overlays.backscatter) {
      if (!o._bs) {
        o._bs = "loading";
        const im = new Image();
        im.onload = () => { const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const cx = c.getContext("2d"); cx.drawImage(im, 0, 0);
          try { const d = cx.getImageData(0, 0, c.width, c.height).data, db = new Float32Array(c.width * c.height); for (let i = 0; i < db.length; i++) db[i] = d[4 * i + 3] < 128 ? NaN : -25 + (25 * (d[4 * i] - 8)) / 227; o._bs = { w: c.width, h: c.height, db }; } catch (e) { o._bs = "fail"; }
          drawMap(false); };
        im.onerror = () => { o._bs = "fail"; };
        im.src = o.overlays.backscatter;
      } else if (o._bs.db) {
        const g = o._bs, base = S.baseForSim == null ? S.thr : S.baseForSim;
        const url = E.gridToURL(g.w, g.h, (i) => { const v = g.db[i]; if (!Number.isFinite(v) || v >= S.thr) return null; return v < base ? [110, 195, 212, 225] : [229, 143, 180, 245]; });
        add([o.overlays.backscatter, url], o.bounds, "afterPane");
        const sim = S.mode === "simulate" && S.simX;
        $("#legend").innerHTML = `<h4>${sim ? 'Flood scenario <span class="tag tag-sim">SIM</span>' : `Open water ${E.tag(o.provenance)}`}</h4><ul><li><span class="sw" style="background:#6ec3d4"></span>Water &lt; ${String(base).replace("-", "−")} dB</li>${sim ? '<li><span class="sw" style="background:#e58fb4"></span>Newly flooded (scenario)</li>' : ""}</ul><p class="note">recomputed live from the radar image</p>`;
        if (fit) { const bb = L.latLngBounds(o.bounds); map.setMaxBounds(bb.pad(1.2)); map.fitBounds(bb, { padding: [24, 24] }); }
        applyClip();
        return;
      }
    }
    if (S.compare && p) {
      const lay = layer === "change" ? "water" : layer;
      add(imagesFor(o, p, lay), o.bounds, "afterPane");
      add(imagesFor(p, S.idx > 1 ? series()[S.idx - 2] : null, lay), p.bounds, "beforePane");
      $("#swipe-before").innerHTML = `BEFORE ${E.esc(p.date)} ${E.tag(p.provenance)}`;
      $("#swipe-after").innerHTML = `AFTER ${E.esc(o.date)} ${E.tag(o.provenance)}`;
    } else if (o) add(imagesFor(o, p, layer), o.bounds, "afterPane");
    $("#legend").innerHTML = legendHTML(layer, o);
    if (fit && o) {
      const b = L.latLngBounds(o.bounds);
      map.setMaxBounds(b.pad(1.2));
      map.fitBounds(b, { padding: [24, 24] });
    }
    applyClip();
  }
  function legendHTML(layer, o) {
    const pv = o ? E.tag(o.provenance) : "", thr = String(S.thr).replace("-", "−");
    if (layer === "radar") return `<h4>Radar backscatter ${pv}</h4><div class="bar" style="background:linear-gradient(90deg,#080c14,#ebf0fa)"></div><div class="ends"><span>−25 dB</span><span>0 dB</span></div><p class="note">dark = smooth (water) · bright = rough / built</p>`;
    if (layer === "change") return `<h4>Change vs previous ${pv}</h4><div class="bar" style="background:linear-gradient(90deg,#2166ac,#f5f5f5,#b2182b)"></div><div class="ends"><span>−6 dB</span><span>0</span><span>+6 dB</span></div><p class="note">blue = darker (wetter / smoother) · red = brighter</p>`;
    return `<h4>Open water ${pv}</h4><ul><li><span class="sw" style="background:#6ec3d4"></span>Water &lt; ${thr} dB</li><li><span class="sw" style="background:#e58fb4"></span>New since previous date</li></ul><p class="note">water = backscatter below the threshold</p>`;
  }
  function applyClip() {
    if (!map) return;
    const card = $("#map-card"), on = S.compare && !!prev();
    card.classList.toggle("comparing", on);
    if (!on) { afterPane.style.clip = ""; beforePane.style.clip = ""; return; }
    const size = map.getSize(), x = Math.round((size.x * S.swipe) / 100);
    const nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
    beforePane.style.clip = `rect(${nw.y}px, ${nw.x + x}px, ${se.y}px, ${nw.x}px)`;
    afterPane.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${nw.x + x}px)`;
    const h = $("#swipe");
    h.style.left = `${x}px`; h.style.height = `${size.y}px`;
    h.setAttribute("aria-valuenow", String(Math.round(S.swipe)));
  }
  function initSwipe() {
    const h = $("#swipe");
    let drag = false;
    const setX = (cx) => { const r = $("#map").getBoundingClientRect(); S.swipe = E.clamp(((cx - r.left) / r.width) * 100, 2, 98); applyClip(); };
    h.addEventListener("pointerdown", (e) => { drag = true; h.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
    h.addEventListener("pointermove", (e) => { if (drag) setX(e.clientX); });
    h.addEventListener("pointerup", () => { drag = false; });
    h.addEventListener("pointercancel", () => { drag = false; });
    h.addEventListener("keydown", (e) => {
      const st = e.shiftKey ? 10 : 2;
      if (e.key === "ArrowLeft") S.swipe = E.clamp(S.swipe - st, 2, 98);
      else if (e.key === "ArrowRight") S.swipe = E.clamp(S.swipe + st, 2, 98);
      else return;
      e.preventDefault(); applyClip();
    });
  }

  let obsSms = null;
  function simThreshold(o) {
    if (S.mode !== "simulate" || !S.simX || !o) return null;
    const base = E.waterPct(o, S.thr), target = base * (1 + S.simX / 100);
    for (let t = Math.ceil(S.thr); t <= -10; t++) { const w = E.waterPct(o, t); if (E.isNum(w) && w >= target) return t; }
    return -10;
  }
  function render(opts = {}) {
    const baseThr = S.thr;
    S.simThr = simThreshold(series()[E.clamp(S.idx, 0, Math.max(0, series().length - 1))]);
    S.baseForSim = baseThr;
    if (S.simThr != null) S.thr = S.simThr;
    try { renderInner(opts, baseThr); } finally { S.thr = baseThr; }
  }
  function renderInner(opts, baseThr) {
    const l = loc(), ser = series();
    S.idx = E.clamp(S.idx, 0, Math.max(0, ser.length - 1));
    const o = cur(), p = prev();
    $$("#site-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === S.key)));
    $$("#layer-seg button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.layer === S.layer)); if (b.dataset.layer === "change") { b.disabled = !p; b.title = p ? "" : "Needs a second date"; } });
    if (S.layer === "change" && !p) S.layer = "water";
    $("#site-title").textContent = l.name;
    $("#site-sub").innerHTML = `${E.esc(l.region.charAt(0) + l.region.slice(1).toLowerCase())} · ${E.esc(l.phenomenon)} ${E.tag(l.provenance)}`;
    $("#dates").innerHTML = ser.map((x, i) => `<button type="button" data-i="${i}" aria-pressed="${i === S.idx}">${E.esc(x.date)}</button>`).join("");
    $$("#dates button").forEach((b) => b.addEventListener("click", () => { S.idx = Number(b.dataset.i); render(); }));
    const cmp = $("#btn-compare");
    cmp.disabled = !p;
    cmp.setAttribute("aria-pressed", String(S.compare && !!p));
    cmp.title = p ? "Drag the divider to compare" : "Needs a second date";
    renderStats(l, o, p);
    if (S.mode === "simulate" && o) {
      const w0 = E.waterPct(o, baseThr), w1 = E.waterPct(o, S.thr), km = E.waterKm2(o, S.thr);
      $$("#stats .kpi .k").forEach((k) => { if (!k.querySelector(".tag-sim")) k.insertAdjacentHTML("beforeend", '<span class="tag tag-sim">SIM</span>'); });
      $$("#stats .kpi .v").forEach((v) => { v.style.color = "var(--sim)"; });
      if ($("#obs-sim-note")) $("#obs-sim-note").innerHTML = `Scenario: open water ${E.fmt(w0, 1)}% → <b>${E.fmt(w1, 1)}%</b>${E.isNum(km) ? ` (≈ ${Math.round(km).toLocaleString("en-US")} km²)` : ""} · water threshold moved from ${String(baseThr).replace("-", "−")} to ${String(S.thr).replace("-", "−")} dB · pink = newly flooded in the scenario`;
      if (false) obsSms(S.simX >= 150 ? (/Jamuna/.test(l.name) ? SIMULATED_SMS_BN : SMS_BN_FLOOD) : null, "bn", S.simX >= 150 ? `Would go to registered phones in ${l.name.split(",")[0]}` : "");

    }
    drawMap(opts.fit);
    renderCharts(l, o, p);
    renderSources(l, o);
  }

  function renderStats(l, o, p) {
    if (!o) { $("#stats").innerHTML = E.na(); return; }
    const pv = o.provenance, wp = E.waterPct(o, S.thr), wk = E.waterKm2(o, S.thr), wpp = p ? E.waterPct(p, S.thr) : null;
    const dW = E.isNum(wp) && E.isNum(wpp) ? wp - wpp : null;
    const k = (name, v, unit, sub, cls = "") => `<div class="kpi"><span class="k"><span>${name}</span></span><span class="v${v === E.NA ? " na" : ""}">${E.esc(v)}${unit && v !== E.NA ? `<small>${unit}</small>` : ""}</span><span class="d ${cls}">${sub || ""}</span></div>`;
    $("#stats").innerHTML =
      k("Open water", E.isNum(wp) ? wp.toFixed(1) : E.NA, "%", E.isNum(wk) ? `≈ ${Math.round(wk).toLocaleString("en-US")} km²` : "") +
      k("Change vs previous", E.isNum(dW) ? E.signed(dW, 1) : E.NA, E.isNum(dW) ? "pp" : "", p ? `${E.esc(p.date)} → ${E.esc(o.date)}` : "needs a second date", dW > 0 ? "up" : dW < 0 ? "dn" : "") +
      k("Mean backscatter", E.isNum(o.stats.meanBackscatterDb) ? o.stats.meanBackscatterDb.toFixed(1) : E.NA, "dB", "scene mean") +
      k("Changed pixels", E.isNum(o.stats.percentChanged) ? o.stats.percentChanged.toFixed(1) : E.NA, E.isNum(o.stats.percentChanged) ? "%" : "", `|Δ| ≥ ${E.CHANGE_DB} dB`) +
      `<div class="kpi"><span class="k"><span>Acquired</span></span><span class="v" style="font-size:26px">${E.esc(o.date)}</span><span class="d">${E.tag(pv)}</span></div>`;
    $("#granule").innerHTML = pv === E.P.REAL ? `<span class="mono">${E.esc(o.granule || "")}</span>` : `<span class="demo-stamp">DEMO</span> illustrative scenario — not a NASA observation`;
  }

  let OBS_DATES = [], RAIN_ROWS = null;
  /* Daily rain (NASA POWER) with the 72-h sum, the HIGH-rain line and every NISAR pass for this area. */
  function drawRainChart() {
    const el = $("#ch-rain"); if (!el || !RAIN_ROWS || !RAIN_ROWS.length) return;
    const rows = RAIN_ROWS, W = 620, H = 230, m = { l: 44, r: 14, t: 16, b: 34 };
    const s72 = rows.map((r, i) => { const w = rows.slice(Math.max(0, i - 2), i + 1).map((x) => x.mm); return w.length === 3 && w.every((x) => x != null) ? w.reduce((a, c) => a + c, 0) : null; });
    const mx = Math.max(RISK_RULES.rainHighMm * 1.15, ...rows.map((r) => r.mm || 0), ...s72.map((v) => v || 0));
    const f = E.frame({ W, H, m, x0: -0.5, x1: rows.length - 0.5, y0: 0, y1: mx, xTicks: rows.map((_, i) => i).filter((i) => i % 7 === 0), xFmt: (i) => (rows[i] ? rows[i].date.slice(5) : ""), yLabel: "rain (mm)" });
    const bw = (W - m.l - m.r) / rows.length;
    let sv = f.s + `<line x1="${m.l}" x2="${W - m.r}" y1="${f.Y(RISK_RULES.rainHighMm)}" y2="${f.Y(RISK_RULES.rainHighMm)}" stroke="#e07a6a" stroke-dasharray="4 4" opacity=".7"/><text x="${W - m.r}" y="${f.Y(RISK_RULES.rainHighMm) - 5}" text-anchor="end" style="fill:#e07a6a">72-h HIGH ${RISK_RULES.rainHighMm} mm</text>`;
    const dates = new Set(OBS_DATES.concat((window.ESArea && window.ESArea.get() && [window.ESArea.get().after, window.ESArea.get().before].filter(Boolean).map((x) => x.date)) || []));
    rows.forEach((r, i) => {
      if (dates.has(r.date)) sv += `<line x1="${f.X(i)}" x2="${f.X(i)}" y1="${m.t}" y2="${H - m.b}" stroke="#d4b483" stroke-width="1.5"/><text x="${f.X(i) + 3}" y="${m.t + 10}" style="fill:#d4b483;font-size:9px">NISAR</text>`;
      const v = r.mm || 0; sv += `<rect x="${f.X(i) - bw * 0.35}" y="${f.Y(v)}" width="${bw * 0.7}" height="${Math.max(0.5, f.Y(0) - f.Y(v))}" fill="#6ec3d4" opacity=".75"><title>${r.date}: ${v.toFixed(1)} mm</title></rect>`;
    });
    sv += `<path d="${s72.map((v, i) => (v == null ? "" : `${s72[i - 1] == null ? "M" : "L"}${f.X(i).toFixed(1)} ${f.Y(v).toFixed(1)}`)).join(" ")}" fill="none" stroke="#b9a3e6" stroke-width="2"/>`;
    const tot = rows.reduce((a, r) => a + (r.mm || 0), 0), wet = rows.filter((r) => (r.mm || 0) >= 1).length, peak = Math.max(...s72.filter((v) => v != null));
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily rainfall with 72-hour sum and NISAR passes">${sv}</svg>
      <p class="cap">■ daily rain · <span style="color:#b9a3e6">— 72-h sum</span> · <span style="color:#d4b483">| NISAR pass</span> · ${rows.length} days: ${tot.toFixed(0)} mm total, ${wet} wet days, peak 72-h ${peak.toFixed(0)} mm · ${E.tag("CURRENT")} NASA POWER</p>`;
  }
  function renderCharts(l, o, p) {
    const pv = o ? o.provenance : l.provenance, ser = series();
    const W = 620;
    const pts = (fn) => ser.map((x) => ({ x: Date.parse(x.date), y: fn(x), id: x.id }));
    // 1. water over time
    $("#ch-water").innerHTML = ser.length >= 2
      ? E.lineChart({ series: [{ name: "open water %", color: E.COL.cy, points: pts((x) => E.waterPct(x, S.thr)) }, { name: "changed pixels %", color: E.COL.acc, dash: true, points: pts((x) => x.stats.percentChanged).map((q) => ({ x: q.x, y: q.y })) }], title: "", yLabel: "%", dates: true, markId: o && o.id, H: 230, W, fill: true })
      : `<div class="kpi" style="padding:0"><span class="v">${E.fmt(E.waterPct(o, S.thr), 1)}<small>%</small></span><span class="d">open water on ${E.esc(o.date)} — the time series starts with the second date</span></div>`;
    // 2. change distribution
    const h = o && o.stats.histogram;
    $("#ch-hist").innerHTML = h
      ? E.histChart({ edges: h.edgesDb, counts: h.counts, title: "", xLabel: "Δ backscatter (dB)", prov: null, colorFn: (v) => E.color((E.clamp(v, -6, 6) + 6) / 12, E.STOPS.div), marks: [-E.CHANGE_DB, E.CHANGE_DB] }) + `<p class="cap">${E.esc(p.date)} → ${E.esc(o.date)} · dashed lines at ±${E.CHANGE_DB} dB</p>`
      : E.na("Change distribution appears once a second date of the same track is processed.");
    // 3. threshold sensitivity
    const curve = (x) => E.WATER_CURVE.map((t) => ({ x: t, y: E.waterPct(x, t) }));
    const cs = [{ name: o.date, color: E.COL.cy, points: curve(o) }];
    if (p) cs.push({ name: p.date, color: E.COL.mu, dash: true, points: curve(p) });
    const a = E.waterPct(o, S.thr - 1), b = E.waterPct(o, S.thr + 1);
    $("#ch-thr").innerHTML = E.lineChart({ series: cs, title: "", xLabel: "water threshold (dB)", yLabel: "% open water", vline: { x: S.thr, label: String(S.thr).replace("-", "−") }, H: 230, W, fill: true }) +
      `<p class="cap">sensitivity at the chosen threshold: ${E.isNum(a) && E.isNum(b) ? ((b - a) / 2).toFixed(2) : "—"} percentage points per dB</p>`;
    // 4. rain vs radar passes (filled in by the flood simulator once NASA POWER answers)
    OBS_DATES = ser.map((x) => x.date);
    if (RAIN_ROWS) drawRainChart();
    $("#flood-flag").innerHTML = "";
  }

  /* Data sources drawer: processing record + a light live check of the NASA catalog for this site. */
  async function renderSources(l, o) {
    const pr = (o && o.processing) || {};
    $("#src-proc").innerHTML = o && o.provenance === E.P.REAL
      ? `<dl class="kv"><dt>Source file</dt><dd class="mono">${E.esc(o.sourceFile || "")}</dd><dt>Dataset</dt><dd class="mono">${E.esc(pr.dataset || "")}</dd><dt>Projection</dt><dd>EPSG:${E.esc(pr.sourceEpsg)} → Web Mercator</dd><dt>Acquired</dt><dd>${E.esc(o.datetime || o.date)} (${E.esc(o.dateSource || "file")})</dd><dt>Maturity</dt><dd>${E.esc(o.maturity || E.NA)}</dd><dt>Output</dt><dd>${pr.outputPixels ? pr.outputPixels.join(" × ") + " px" : ""} · ${pr.outputBytes ? Math.round(pr.outputBytes / 1024) + " KB" : ""}</dd></dl>`
      : `<p class="mu">${E.tag(E.P.DEMO)} Synthetic scenario from js/locations.js. Run <code>fetch_nisar_subset.py</code> + <code>process_nisar.py</code> to replace it with real NISAR data.</p>`;
    const el = $("#src-live");
    el.innerHTML = `<p class="na">querying NASA CMR…</p>`;
    try {
      const [[s, w], [n, e]] = l.bounds;
      const j = await getJSON(`https://cmr.earthdata.nasa.gov/search/granules.json?provider=ASF&short_name=NISAR_L2_GCOV_PROVISIONAL_V1&bounding_box=${w},${s},${e},${n}&sort_key=-start_date&page_size=60`);
      if (loc() !== l) return;
      const it = j.feed.entry.map((x) => x.time_start);
      const latest = it[0] ? it[0].slice(0, 10) : null;
      el.innerHTML = `<dl class="kv"><dt>GCOV scenes over site</dt><dd>${it.length}${it.length === 60 ? "+" : ""} ${E.tag("CURRENT")}</dd><dt>Latest acquisition</dt><dd>${latest || E.NA}</dd><dt>Nominal repeat</dt><dd>12 days per track</dd><dt>Next pass (same track as latest)</dt><dd>${latest ? iso(Date.parse(latest) + 12 * dayMs) + " · predicted" : E.NA}</dd></dl>`;
    } catch (err) { el.innerHTML = `<p class="na">Live catalog unavailable (${E.esc(err.message)}).</p>`; }
  }

  function exportSummary() {
    const l = loc(), o = cur(), p = prev();
    if (!o) return;
    const row = (k, v) => `<tr><th>${E.esc(k)}</th><td>${E.esc(v)}</td></tr>`;
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>EchoSphere summary — ${E.esc(l.name)} ${E.esc(o.date)}</title><style>body{font:15px/1.6 Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111}th{text-align:left;padding:4px 18px 4px 0;color:#555;font-weight:400}td{padding:4px 0}.w{border-left:3px solid #b00;padding:6px 12px;background:#fdf1f0}</style></head><body>
<h1>EchoSphere analysis summary</h1><p>${E.esc(new Date().toISOString())} · Provenance: <b>${E.esc(o.provenance)}</b></p>
${o.provenance === E.P.DEMO ? '<p class="w"><b>DEMO DATA.</b> Illustrative scenario — not a NASA or NISAR observation.</p>' : ""}
<table>${row("Site", l.name)}${row("Acquisition", o.datetime || o.date)}${row("Granule", o.granule || E.NA)}${row("Open water", E.fmt(E.waterPct(o, S.thr), 1, "%") + " at " + S.thr + " dB")}${row("Change vs previous", p ? E.signed(E.waterPct(o, S.thr) - E.waterPct(p, S.thr), 1, " pp") + ` (${p.date} → ${o.date})` : "needs a second date")}${row("Mean backscatter", E.fmt(o.stats.meanBackscatterDb, 2, " dB"))}${row("Changed pixels (|Δ| ≥ 3 dB)", E.fmt(o.stats.percentChanged, 1, "%"))}</table>
<h2>Method</h2><p>Linear backscatter (GCOV HHHH) reprojected to Web Mercator with average resampling, NISAR validity mask applied, converted to dB. Change = after − before per pixel. Water = backscatter below the threshold.</p>
<h2>Uncertainty</h2><p>Speckle, wind-roughened water, flooded vegetation, soil moisture, incidence angle, mixed pixels and downsampling all affect the result. No ground validation.</p>
<h2>Source</h2><p>${o.provenance === E.P.REAL ? `NASA-ISRO NISAR, ASF DAAC · ${E.esc(o.sourceFile || "")}` : "EchoSphere DEMO scenario"}</p></body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `echosphere-${l.key}-${o.date}-${o.provenance === E.P.REAL ? "REAL-NISAR" : "DEMO"}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ======================================================================
     ACT (Bangladesh): feed the rule engine with real signals
     ====================================================================== */
  async function initAct() {
    const area = window.ESArea && window.ESArea.get();
    const locs = E.buildLocations(), l = locs.find((x) => x.key === "bangladesh");
    const ser = bsObs(l);
    let o = ser[ser.length - 1], p = ser[ser.length - 2];
    const water = $("#rule-water"), rain = $("#rule-rain");
    let w = o ? E.waterPct(o, E.DEFAULT_THRESHOLD) : null, wp = p ? E.waterPct(p, E.DEFAULT_THRESHOLD) : null;
    if (area && area.key !== "jamuna") { // use the selected area's radar imagery values
      o = area.after ? { date: area.after.date, provenance: E.P.REAL } : o;
      p = area.before ? { date: area.before.date } : null;
      w = area.after ? area.after.water : null; wp = area.before ? area.before.water : null;
      const h = document.querySelector("#act .section-head .eyebrow"); if (h) h.textContent = `Flood warning · ${area.name}`;
      $("#sms-text").textContent = SMS_BN_FLOOD;
    }
    const rise = E.isNum(w) && E.isNum(wp) && wp > 0 ? ((w - wp) / wp) * 100 : null;
    $("#in-water").innerHTML = `<span class="v">${E.isNum(rise) ? E.signed(rise, 0) : E.fmt(w, 1)}<small>${E.isNum(rise) ? "%" : "% water"}</small></span>
      <span class="src">${E.tag(o.provenance)} ${E.isNum(rise) ? `${E.esc(p.date)} → ${E.esc(o.date)}` : `${E.esc(o.date)} · rise needs a second date`}</span>`;
    const real = { water: E.isNum(rise) ? E.clamp(Math.round(rise), 0, 100) : 0, rain: null, riseTxt: E.isNum(rise) ? `${E.signed(rise, 0)}%` : "n/a", dates: p ? `${p.date} → ${o.date}` : o.date };
    const set = (wv, rv) => { water.value = String(wv); rain.value = String(rv); water.dispatchEvent(new Event("input", { bubbles: true })); };
    const setMode = (m) => {
      $$("#mode-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
      $("#sim-controls").hidden = m !== "simulate";
      document.body.dataset.mode = m;
      if (m === "current") {
        set(real.water, real.rain == null ? 0 : real.rain);
        $("#mode-note").innerHTML = `${E.tag(o.provenance)} ${E.tag("CURRENT")} decision from real data · water ${E.esc(real.riseTxt)} (${E.esc(real.dates)}) · rain ${real.rain == null ? "…" : real.rain + " mm"}`;
      } else $("#mode-note").innerHTML = `${E.tag(E.P.SIM)} scenario — values are hypothetical, not observations`;
    };
    const watchDecision = () => {
      const lv = ($("#rule-result").textContent || "").trim();
      setStatus({ risk: lv || null, mode: document.body.dataset.mode || "current" });
      if (document.body.dataset.mode === "simulate" && lv === "HIGH") showAlert(`HIGH flood risk — ${area ? area.name : "Jamuna chars"}`, `Water rise ${water.value}% with ${rain.value} mm of rain in 72 h. Sending emergency SMS to all registered phones in ${area ? area.name.split(",")[0] : "the Jamuna chars"}.`);
      else hideAlert(false);
    };
    [water, rain].forEach((el) => el.addEventListener("input", () => setTimeout(watchDecision, 0)));
    $$("#mode-seg button").forEach((b) => b.addEventListener("click", () => { resetAlert(); setMode(b.dataset.mode); setTimeout(watchDecision, 0); }));

    $$("[data-preset]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.preset === "real") return set(real.water, real.rain || 0); const [wv, rv] = b.dataset.preset.split(",").map(Number); set(wv, rv); }));
    setMode("current");
    setTimeout(watchDecision, 0);
    const top = $("#obs-mode");
    if (top) {
      $("#mode-seg").hidden = true;
      $$("#obs-mode button").forEach((b) => b.addEventListener("click", () => { resetAlert(); setMode(b.dataset.mode); setTimeout(watchDecision, 0); }));
    }
    const rEl = $("#in-rain");
    rEl.innerHTML = `<span class="v na">loading…</span>`;
    let rows = [];
    try {
      const end = new Date(Date.now() - dayMs), start = new Date(end.getTime() - 40 * dayMs), f = (d) => iso(d).replace(/-/g, "");
      const ctr = area ? [((area.bbox[1] + area.bbox[3]) / 2).toFixed(3), ((area.bbox[0] + area.bbox[2]) / 2).toFixed(3)] : ["24.550", "89.700"];
      const j = await getJSON(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&longitude=${ctr[1]}&latitude=${ctr[0]}&start=${f(start)}&end=${f(end)}&format=JSON`);
      const v = j.properties.parameter.PRECTOTCORR;
      rows = Object.keys(v).sort().map((k) => ({ date: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6)}`, mm: v[k] > -900 ? v[k] : null }));
      RAIN_ROWS = rows; drawRainChart();
      const ok = rows.filter((r) => r.mm != null), last3 = ok.slice(-3), sum = last3.reduce((a, r) => a + r.mm, 0);
      rEl.innerHTML = `<span class="v">${sum.toFixed(0)}<small>mm</small></span><span class="src">${E.tag("CURRENT")} NASA POWER · 72 h to ${E.esc(last3[2] ? last3[2].date : "")}</span>`;
      real.rain = E.clamp(Math.round(sum / 5) * 5, 0, 250);
      if (document.body.dataset.mode !== "simulate") setMode("current");
    } catch (err) { rEl.innerHTML = `<span class="v na">unavailable</span><span class="src">${E.esc(err.message)}</span>`; real.rain = 0; if (document.body.dataset.mode !== "simulate") setMode("current"); }
    // 16-day outlook with forecast rain (Open-Meteo) and the observed NISAR rise
    const fc = $("#fc-risk");
    try {
      const c2 = area ? [((area.bbox[1] + area.bbox[3]) / 2).toFixed(3), ((area.bbox[0] + area.bbox[2]) / 2).toFixed(3)] : ["24.550", "89.700"];
      const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${c2[0]}&longitude=${c2[1]}&daily=precipitation_sum&forecast_days=16&timezone=UTC`);
      const om = j.daily.time.map((t, i) => ({ date: t, mm: j.daily.precipitation_sum[i] }));
      const all = rows.slice(-2).concat(om);
      const days = om.map((r) => { const i = all.findIndex((a) => a.date === r.date); const win = all.slice(Math.max(0, i - 2), i + 1).map((a) => a.mm); const s72 = win.length === 3 && win.every((x) => x != null) ? win.reduce((a, c) => a + c, 0) : null; return { ...r, s72, level: RISK_RULES.evaluate(E.isNum(rise) ? rise : Number(water.value), s72).level }; });
      const lc = { HIGH: "#e07a6a", MEDIUM: "#e0b45c", LOW: "#86c9a0" };
      const W = 900, H = 220, m = { l: 44, r: 16, t: 16, b: 40 }, mx = Math.max(RISK_RULES.rainHighMm * 1.2, ...days.map((d) => d.s72 || 0));
      const fr = E.frame({ W, H, m, x0: -0.5, x1: days.length - 0.5, y0: 0, y1: mx, xTicks: days.map((_, i) => i).filter((i) => i % 2 === 0), xFmt: (i) => (days[i] ? days[i].date.slice(5) : ""), yLabel: "72-h rain (mm)" });
      const bw = (W - m.l - m.r) / days.length;
      let sv = fr.s + `<line x1="${m.l}" x2="${W - m.r}" y1="${fr.Y(RISK_RULES.rainHighMm)}" y2="${fr.Y(RISK_RULES.rainHighMm)}" stroke="#e07a6a" stroke-dasharray="4 4" opacity=".7"/><text x="${W - m.r}" y="${fr.Y(RISK_RULES.rainHighMm) - 6}" text-anchor="end" style="fill:#e07a6a">HIGH rain threshold ${RISK_RULES.rainHighMm} mm</text>`;
      days.forEach((d, i) => { const v = d.s72 || 0; sv += `<rect x="${fr.X(i) - bw * 0.32}" y="${fr.Y(v)}" width="${bw * 0.64}" height="${Math.max(1, fr.Y(0) - fr.Y(v))}" rx="4" fill="${lc[d.level] || "#34343c"}" opacity=".9"><title>${d.date}: ${v.toFixed(0)} mm → ${d.level || "n/a"}</title></rect><text x="${fr.X(i)}" y="${H - 20}" text-anchor="middle" style="fill:${lc[d.level] || "#6c6b66"};font-size:9px">${d.level ? "▲".repeat({ LOW: 1, MEDIUM: 2, HIGH: 3 }[d.level]) : "–"}</text>`; });
      fc.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="16-day simulated risk outlook">${sv}</svg><p class="cap">${E.tag("CURRENT")} Open-Meteo forecast rain (not NASA) + NISAR water signal · ${E.tag(E.P.SIM)} prototype rules · not a flood forecast</p>`;
    } catch (err) { fc.innerHTML = E.na(`Forecast unavailable (${err.message}).`); }
  }

  /* ======================================================================
     EROSION WATCH (data/erosion.js, generated by erosion_watch.py)
     ====================================================================== */
  /* Erosion scenario for any selected area: both banks retreat by N m along a river crossing the box. */
  /* Simulated feature-phone SMS for erosion warnings. */
  const SMS_BN = "সতর্কতা: যমুনার পাড় ভাঙন আপনার গ্রামের দিকে এগিয়ে আসছে। ঘরের মালামাল ও গবাদি পশু নিরাপদ স্থানে সরান।";
  const SMS_BN_ERO = "সতর্কতা: নদীর পাড় ভাঙন আপনার গ্রামের দিকে এগিয়ে আসছে। ঘরের মালামাল ও গবাদি পশু নিরাপদ স্থানে সরান।";
  const SMS_BN_FLOOD = "সতর্কতা: আপনার এলাকায় আগামী ২৪ ঘণ্টায় বন্যার ঝুঁকি বেশি। নিরাপদ স্থানে যান।";
  function erosionDiag(a, nearM, nearName) {
    const none = nearM == null; if (none) { nearM = 99999; nearName = "no settlement within 8 km"; }
    const W = 640, H = 190, x0 = 70, px = 380 / 1500, bank = x0 + 120 + Math.min(a, 1500) * px, house = x0 + 120 + Math.min(nearM, 1500) * px, hit = a >= nearM;
    return `<svg class="chart diag" viewBox="0 0 ${W} ${H}" role="img" aria-label="River cross-section: bank retreat ${a} m, nearest settlement ${nearM} m">
      <rect x="${x0}" y="120" width="120" height="50" fill="#2a6f7d"/>
      ${a > 0 ? `<rect x="${x0 + 120}" y="120" width="${bank - x0 - 120}" height="50" fill="#e05a6e" opacity=".75"/>` : ""}
      <rect x="${bank}" y="112" width="${Math.max(0, W - bank - 20)}" height="58" fill="#5b4a32"/>
      <line x1="${bank}" x2="${bank}" y1="96" y2="176" stroke="#b9a3e6" stroke-width="2" stroke-dasharray="5 4"/>
      <text x="${bank}" y="90" text-anchor="middle" class="t">bank +${a} m</text>
      ${none ? "" : `<g transform="translate(${house - 11},${hit ? 118 : 86})"><path d="M0 12 L11 0 L22 12 L22 26 L0 26 Z" fill="${hit ? "#ff5a4a" : "#e0b45c"}"/></g>
      <text x="${house}" y="${hit ? 186 : 76}" text-anchor="middle">${E.esc(nearName)} · ${nearM} m</text>`}
      <text x="${x0 + 60}" y="150" text-anchor="middle">river</text>
      <text x="${x0}" y="30" class="t">${none ? E.esc(nearName) : hit ? "River reaches the settlement" : `${Math.max(0, nearM - a)} m of land left before ${E.esc(nearName)}`}</text>
    </svg>`;
  }
  function smsPhone(host) {
    host.innerHTML = `<div class="ew-smsbox"><div class="phone" role="img" aria-label="Simulated feature phone showing an erosion warning SMS"><div class="spk"></div><div class="screen"><div class="st"><span>▂▄▆ 2G</span><span>SMS</span><span>▮▮▮▯</span></div><div class="sms-on" hidden><div class="from">FROM: ECHOSPHERE-SIM</div><p class="sms"></p></div><p class="sms sms-idle" style="font:12px var(--mono)">No new messages<br>(below warning level)</p></div><div class="keys">${"1 2 3 4 5 6 7 8 9 * 0 #".split(" ").map((x) => `<span>${x}</span>`).join("")}</div></div>
      <figcaption class="phone-caption"><span class="tag tag-sim">SIMULATED MESSAGE</span><span class="fa sms-who" role="status"></span></figcaption></div>`;
    return (text, lang, who) => {
      host.querySelector(".sms-on").hidden = !text; host.querySelector(".sms-idle").hidden = !!text;
      const p = host.querySelector(".sms-on .sms"); p.textContent = text || ""; p.lang = lang || "en";
      host.querySelector(".sms-who").textContent = text ? who || "" : "";
    };
  }
  /* Water mask of a selected area (from its NISAR image), used to grow the river outward. */
  function erosionOverlay(area, cb) {
    const shot = area.after; if (!shot || !shot.img) return cb(null);
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => {
      const W = Math.min(im.naturalWidth, 700), H = Math.round((im.naturalHeight * W) / im.naturalWidth);
      const c = document.createElement("canvas"); c.width = W; c.height = H; const cx = c.getContext("2d"); cx.drawImage(im, 0, 0, W, H);
      let d; try { d = cx.getImageData(0, 0, W, H).data; } catch (e) { return cb(null); }
      const water = new Uint8Array(W * H), lum = new Float32Array(W * H).fill(NaN);
      for (let i = 0; i < W * H; i++) {
        const r = d[4 * i], g = d[4 * i + 1], b = d[4 * i + 2], a = d[4 * i + 3];
        if (a < 128) continue;
        if (shot.imgWater) water[i] = 1; else if (r + g + b >= 6) { lum[i] = 0.299 * r + 0.587 * g + 0.114 * b; if (lum[i] < 55) water[i] = 1; }
      }
      const count = (m) => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; };
      const core = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (!water[i]) continue; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += water[i + dy * W + dx]; if (n >= 8) core[i] = 1; }
      // little or no open water: fall back to the raw water pixels, then to the darkest (lowest, smoothest) 0.5 % of ground
      let fallback = null;
      if (count(core) >= 50) water.set(core);
      else if (count(water) < 50) {
        const v = Array.from(lum).filter(Number.isFinite).sort((x, y) => x - y), cut = v[Math.floor(v.length * 0.005)];
        if (v.length) { for (let i = 0; i < lum.length; i++) water[i] = lum[i] <= cut ? 1 : 0; fallback = "no open water detected — flooding spreads from the darkest (lowest, smoothest) radar ground"; }
      } else fallback = "little open water — using every detected water pixel";
      const bb = shot.bounds ? [shot.bounds[0][1], shot.bounds[0][0], shot.bounds[1][1], shot.bounds[1][0]] : area.bbox;
      const mPerPx = ((bb[2] - bb[0]) * 111320 * Math.cos(((bb[1] + bb[3]) / 2) * Math.PI / 180)) / W;
      cb({ W, H, water, mPerPx, fallback, bounds: [[bb[1], bb[0]], [bb[3], bb[2]]] });
    };
    im.onerror = () => cb(null);
    im.src = shot.imgWater || shot.img;
  }
  function growMask(m, adv, col = [229, 90, 110, 210]) {
    const r = Math.round(adv / m.mPerPx), { W, H } = m; if (r < 1) return { url: null, px: 0 };
    const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      let last = -1e9; for (let x = 0; x < W; x++) { if (m.water[y * W + x]) last = x; tmp[y * W + x] = x - last <= r ? 1 : 0; }
      last = 1e9; for (let x = W - 1; x >= 0; x--) { if (m.water[y * W + x]) last = x; if (last - x <= r) tmp[y * W + x] = 1; }
    }
    for (let x = 0; x < W; x++) {
      let last = -1e9; for (let y = 0; y < H; y++) { if (tmp[y * W + x]) last = y; out[y * W + x] = y - last <= r ? 1 : 0; }
      last = 1e9; for (let y = H - 1; y >= 0; y--) { if (tmp[y * W + x]) last = y; if (last - y <= r) out[y * W + x] = 1; }
    }
    let px = 0;
    const url = E.gridToURL(W, H, (i) => { if (!out[i] || m.water[i]) return null; px++; return col; });
    return { url, px };
  }
  /* Shared pieces for the per-area simulators. */
  const KPI = (n, v, u, d, sim) => `<div class="kpi"><span class="k"><span>${n}</span>${sim ? '<span class="tag tag-sim">SIM</span>' : ""}</span><span class="v"${sim ? ' style="color:var(--sim)"' : ""}>${E.esc(v)}${u ? `<small>${u}</small>` : ""}</span><span class="d">${d}</span></div>`;
  const areaKm2Of = (bb) => (bb[2] - bb[0]) * 111.32 * Math.cos(((bb[1] + bb[3]) / 2) * Math.PI / 180) * (bb[3] - bb[1]) * 111.32;
  function areaMap(id, area) {
    const m = L.map(id, { zoomSnap: 0.5 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { className: "osm-dark", maxZoom: 16, attribution: "© OpenStreetMap contributors" }).addTo(m);
    const bb = area.bbox, bnds = [[bb[1], bb[0]], [bb[3], bb[2]]];
    m.fitBounds(bnds);
    if (area.after && area.after.img) L.imageOverlay(area.after.img, area.after.bounds || bnds, { opacity: 0.85 }).addTo(m);
    if (area.after && area.after.imgWater) L.imageOverlay(area.after.imgWater, area.after.bounds || bnds).addTo(m);
    return m;
  }
  /* Distance (m) from each OSM place to the nearest water pixel of the mask (searched up to 8 km). */
  function placeDistances(mask, places) {
    const [[s0, w0], [n0, e0]] = mask.bounds, { W, H } = mask, maxR = Math.ceil(8000 / mask.mPerPx);
    return places.map((p) => {
      const cx = Math.round(((p.lon - w0) / (e0 - w0)) * W), cy = Math.round(((n0 - p.lat) / (n0 - s0)) * H);
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return { ...p, dist: null };
      let best = Infinity;
      for (let dy = -maxR; dy <= maxR; dy++) { const y = cy + dy; if (y < 0 || y >= H) continue;
        for (let dx = -maxR; dx <= maxR; dx++) { const x = cx + dx; if (x < 0 || x >= W || !mask.water[y * W + x]) continue; const d = dx * dx + dy * dy; if (d < best) best = d; } }
      return { ...p, dist: Number.isFinite(best) ? Math.round(Math.sqrt(best) * mask.mPerPx) : null };
    }).filter((p) => p.dist != null).sort((x, y) => x.dist - y.dist);
  }

  /* FLOOD WATCH for any selected area: map + KPIs; the Flood simulator's water-rise slider grows the water on the map. */
  function areaFloodSim(area) {
    const box = $("#area-view"), bb = area.bbox;
    if (!box || !bb) return;
    const areaKm2 = areaKm2Of(bb), w0 = area.after && E.isNum(area.after.water) ? area.after.water : null;
    const el = document.createElement("div");
    el.innerHTML = `<div class="pn" style="margin:16px 0"><div class="pn-h"><h3>Flood · ${E.esc(area.name)}</h3><span class="r"><div class="seg" id="obs-mode" role="group" aria-label="Mode"><button type="button" data-mode="current" aria-pressed="true">Current state</button><button type="button" data-mode="simulate" aria-pressed="false">Simulate</button></div></span></div>
      <div class="pn-b"><div class="kpis" id="fl-kpis"></div>
      <div id="fl-map" style="height:460px;border:1px solid var(--line-2);margin-top:12px"></div><p class="cap">NISAR ${E.esc(area.after ? area.after.date : "")} radar + water · <span style="color:#e58fb4">pink = newly flooded in the scenario</span> · drive it with the Flood simulator below</p></div></div>`;
    box.appendChild(el);
    const fmap = areaMap("fl-map", area);
    (area.places || []).forEach((p) => L.circleMarker([p.lat, p.lon], { radius: 4, color: "#e0b45c", weight: 1.5, fillOpacity: 0.8 }).bindTooltip(E.esc(p.name)).addTo(fmap));
    let mode = "current", mask = null, grow = null;
    const waterPx = () => { let n = 0; for (let i = 0; i < mask.water.length; i++) n += mask.water[i]; return n; };
    const draw = () => {
      const pct = mode === "simulate" && $("#rule-water") ? Number($("#rule-water").value) : 0, sim = pct > 0;
      if (grow) { fmap.removeLayer(grow); grow = null; }
      let km = 0, reach = 0;
      if (sim && mask) {
        const target = waterPx() * (pct / 100); let lo = 0, hi = 5000, g = null;
        for (let it = 0; it < 9; it++) { const mid = (lo + hi) / 2, t = growMask(mask, mid, [229, 143, 180, 220]); if (t.px >= target) { hi = mid; g = t; } else lo = mid; }
        if (!g) g = growMask(mask, hi, [229, 143, 180, 220]);
        reach = Math.round(hi); km = (g.px * mask.mPerPx * mask.mPerPx) / 1e6;
        if (g.url) grow = L.imageOverlay(g.url, mask.bounds, { opacity: 0.9 }).addTo(fmap);
      }
      const w1 = w0 == null ? null : Math.min(100, w0 + (100 * km) / areaKm2);
      $("#fl-kpis").innerHTML =
        KPI("Open water", w0 == null ? "—" : sim ? `${w0.toFixed(1)} → ${w1.toFixed(1)}` : w0.toFixed(1), "%", area.after ? `NISAR ${E.esc(area.after.date)}` : "no imagery", sim) +
        KPI("Newly flooded land", sim ? km.toFixed(1) : "0", "km²", sim ? "pink area on the map" : "observed", sim) +
        KPI("Flood reaches", sim ? `+${reach}` : "0", "m", "beyond today's water", sim) +
        KPI("Area", areaKm2.toFixed(0), "km²", "selected box") + KPI("Places in area", String((area.places || []).length), "", "OpenStreetMap");
    };
    $$("#obs-mode button").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; $$("#obs-mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); setStatus({ mode }); draw(); }));
    if ($("#rule-water")) $("#rule-water").addEventListener("input", () => setTimeout(draw, 0));
    draw();
    erosionOverlay(area, (m) => { mask = m; if (m && m.fallback) $("#fl-map").nextElementSibling.insertAdjacentHTML("beforeend", ` · ${m.fallback}`); draw(); });
  }

  /* EROSION WATCH for any selected area — same layout and rule as the Jamuna view. */
  function areaErosionSim(area) {
    const box = $("#area-view"), bb = area.bbox;
    if (!box || !bb) return;
    const areaKm2 = areaKm2Of(bb), w0 = area.after && E.isNum(area.after.water) ? area.after.water : null;
    const el = document.createElement("div");
    el.innerHTML = `<div class="pn" style="margin:16px 0"><div class="pn-h"><h3>Erosion · ${E.esc(area.name)}</h3><span class="r"><div class="seg" id="ew-mode" role="group" aria-label="Mode"><button type="button" data-mode="current" aria-pressed="true">Current state</button><button type="button" data-mode="simulate" aria-pressed="false">Simulate</button></div></span></div>
      <div class="pn-b"><div class="kpis" id="ew-kpis"></div>
      <div id="ew-simmap" style="height:460px;border:1px solid var(--line-2);margin-top:12px"></div><p class="cap">NISAR ${E.esc(area.after ? area.after.date : "")} radar + water · <span style="color:#e55a6e">red = land the river would take</span> · dots = settlements (red = reached)</p></div></div>
      ${EROSION_PANEL}`;
    box.appendChild(el);
    const smap = areaMap("ew-simmap", area);
    const sms = smsPhone($("#ew-sms"));
    let mode = "current", mask = null, grow = null, near = [], dots = L.layerGroup().addTo(smap);
    const draw = (adv) => {
      const sim = mode === "simulate";
      if (grow) { smap.removeLayer(grow); grow = null; }
      let lost = 0;
      if (sim && mask && adv) { const g = growMask(mask, adv); lost = (g.px * mask.mPerPx * mask.mPerPx) / 1e6; if (g.url) grow = L.imageOverlay(g.url, mask.bounds, { opacity: 0.9 }).addTo(smap); }
      dots.clearLayers();
      near.forEach((p) => { const hit = sim && adv >= p.dist; L.circleMarker([p.lat, p.lon], { radius: hit ? 8 : p.dist <= 1000 ? 6 : 4, color: hit ? "#ff5a4a" : p.dist <= 1000 ? "#e0b45c" : "#6c6b66", weight: hit ? 3 : 1.5, fillOpacity: 0.9 }).bindTooltip(`${E.esc(p.name)} · ${p.dist} m from water`).addTo(dots); });
      const reached = sim ? near.filter((p) => adv >= p.dist) : [], nearest = near[0];
      const warn = sim && (adv >= 500 || reached.length > 0);
      const w1 = w0 == null ? null : Math.min(100, w0 + (100 * lost) / areaKm2);
      $("#ew-kpis").innerHTML =
        KPI("Open water", w0 == null ? "—" : sim ? `${w0.toFixed(1)} → ${w1.toFixed(1)}` : w0.toFixed(1), "%", area.after ? `NISAR ${E.esc(area.after.date)}` : "no imagery", sim) +
        KPI("Land lost to river", sim ? lost.toFixed(1) : "0", "km²", sim ? "red area on the map" : "observed", sim) +
        KPI("Bank retreat", `+${sim ? adv : 0}`, "m", sim ? "scenario" : "observed", sim) +
        KPI("Settlements ≤ 1 km", String(near.filter((p) => p.dist - (sim ? adv : 0) <= 1000).length), "", "from the water edge", sim) +
        KPI("Reached", String(reached.length), "", nearest ? `nearest: ${E.esc(nearest.name)} ${nearest.dist} m` : "no settlements found", sim);
      $("#ew-diag").innerHTML = nearest ? erosionDiag(sim ? adv : 0, nearest.dist, nearest.name) : erosionDiag(sim ? adv : 0, null, "");
      sms(warn ? (/bangladesh/i.test(area.name) ? SMS_BN : SMS_BN_ERO) : null, "bn", warn ? `Emergency SMS sent to all registered phones in: ${(reached.length ? reached : near).slice(0, 4).map((p) => p.name).join(", ")}` : "");
      STATUS.flagged = sim ? reached.length : null;
      if (warn) showAlert(reached.length ? `River reaches ${reached.length} settlement${reached.length > 1 ? "s" : ""}` : `HIGH erosion risk — ${area.name}`, `Bank retreat +${adv} m.${reached.length ? ` First affected: ${reached.slice(0, 3).map((p) => p.name).join(", ")}.` : ""} Sending emergency SMS to all registered phones in ${area.name.split(",")[0]}.`); else hideAlert(false);
      setStatus({ mode });
    };
    wireErosionPanel((m) => { mode = m; }, draw);
    erosionOverlay(area, (m) => { mask = m; if (m && m.fallback) $("#ew-simmap").nextElementSibling.insertAdjacentHTML("beforeend", ` · ${m.fallback}`); if (m) near = placeDistances(m, area.places || []); draw(mode === "simulate" ? Number($("#ew-adv").value) : 0); });
  }
  /* The one erosion scenario panel (identical for every area). */
  const EROSION_PANEL = `<section class="pn" id="ew-sim" hidden style="margin-bottom:16px;border-color:rgba(185,163,230,.45)">
    <div class="pn-h"><h3>Erosion simulator · bank retreat → decision → SMS</h3><span class="r"><span class="tag tag-sim">SIMULATED</span></span></div>
    <div class="pn-b"><div class="g" style="margin:0"><div class="c8">
      <label for="ew-adv">Bank retreat toward settlements · <output id="ew-adv-out">0 m</output></label><input type="range" id="ew-adv" min="0" max="1500" step="25" value="0">
      <div class="row" style="margin-top:8px"><button class="btn btn-sm" type="button" data-adv="0">Observed</button><button class="btn btn-sm" type="button" data-adv="200">Moderate</button><button class="btn btn-sm" type="button" data-adv="500">Strong monsoon</button><button class="btn btn-sm" type="button" data-adv="900">Extreme</button></div>
      <pre class="rule active" style="margin-top:12px">IF bank retreat ≥ 500 m OR the bank reaches a settlement
THEN erosion risk = HIGH → send SMS</pre>
      <div id="ew-diag" style="margin-top:10px"></div>
    </div><div class="c4" id="ew-sms"></div></div></div>
  </section>`;
  function wireErosionPanel(onMode, draw) {
    const setAdv = (v) => { $("#ew-adv").value = String(v); $("#ew-adv-out").textContent = `${v} m`; draw(v); };
    $$("#ew-mode button").forEach((b) => b.addEventListener("click", () => {
      const m = b.dataset.mode; onMode(m);
      $$("#ew-mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      $("#ew-sim").hidden = m !== "simulate"; resetAlert(); setAdv(m === "simulate" ? 200 : 0);
    }));
    $("#ew-adv").addEventListener("input", (e) => setAdv(Number(e.target.value)));
    $$("[data-adv]").forEach((b) => b.addEventListener("click", () => { resetAlert(); setAdv(Number(b.dataset.adv)); }));
    setAdv(0);
  }
  function initErosion() {
    const area = window.ESArea && window.ESArea.get();
    if (area && area.key !== "jamuna") { showAreaInstead("Full bank-line analysis is processed for the Jamuna. Below: erosion scenario for this area.", false); areaErosionSim(area); return; }
    const X = typeof EROSION !== "undefined" ? EROSION : null;
    if (!X) { $("#ew-kpis").innerHTML = E.na("No erosion analysis yet — run erosion_watch.py after two Jamuna scenes are in data/raw/."); return; }
    const d0 = X.before.datetime.slice(0, 10), d1 = X.after.datetime.slice(0, 10);
    const flagged = X.settlements.items.filter((s) => s.flag);
    const near1 = X.settlements.items.filter((s) => s.distance_m <= 1000).length;
    const receding = X.water.afterPct < X.water.beforePct;
    $("#ew-sub").innerHTML = `${E.esc(d0)} → ${E.esc(d1)} · ${X.intervalDays} days · same NISAR track ${E.tag(X.provenance)}`;
    $("#ew-verdict").innerHTML = `<div class="pn" style="padding:18px 20px;border-color:${flagged.length ? "rgba(224,122,106,.5)" : "rgba(134,201,160,.4)"}">
      <span class="lbl" style="margin:0 0 6px">Current state</span>
      <div style="font:400 26px/1.15 var(--serif)">${flagged.length ? `${flagged.length} settlement${flagged.length > 1 ? "s" : ""} flagged` : "No settlements flagged"}</div>
      <p class="mu" style="margin:6px 0 0;font-size:13px">${receding ? "The river is receding: most banks moved inward this window." : "Water extent grew this window."} ${flagged.length ? "Flagged places sit near a bank that moved toward them." : "No settlement is near a bank that moved outward beyond the noise level."}</p></div>`;
    const k = (name, v, unit, sub, cls = "") => `<div class="kpi"><span class="k"><span>${name}</span></span><span class="v">${E.esc(v)}${unit ? `<small>${unit}</small>` : ""}</span><span class="d ${cls}">${sub || ""}</span></div>`;
    $("#ew-kpis").innerHTML =
      k("River water", `${X.water.beforePct.toFixed(1)} → ${X.water.afterPct.toFixed(1)}`, "%", "share of scene", receding ? "dn" : "up") +
      k("Land lost to river", X.area.landLostKm2.toFixed(1), "km²", "land → water", "up") +
      k("Land gained", X.area.landGainedKm2.toFixed(1), "km²", "water → land", "dn") +
      k("Median bank move", E.signed((X.shift.west.mean + X.shift.east.mean) / 2, 0), "m", `noise ±${X.method.noise_m} m · + = outward`) +
      k("Settlements ≤ 1 km", String(near1), "", `of ${X.settlements.count} in window`) +
      k("Flagged", String(flagged.length), "", "near + bank moving toward", flagged.length ? "up" : "");

    // ---- map
    const map = L.map("map", { zoomSnap: 0.5, zoomAnimation: false, minZoom: 8, maxZoom: 14, zoomControl: false });
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap", maxZoom: 16 }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    const change = L.imageOverlay(X.overlay.path, X.overlay.bounds, { opacity: 0.95, interactive: false }).addTo(map);
    const banks = L.layerGroup([
      L.polyline(X.banklines.before.west, { color: "#a09f98", weight: 1.5, dashArray: "4 4" }), L.polyline(X.banklines.before.east, { color: "#a09f98", weight: 1.5, dashArray: "4 4" }),
      L.polyline(X.banklines.after.west, { color: "#d4b483", weight: 2 }), L.polyline(X.banklines.after.east, { color: "#d4b483", weight: 2 }),
    ]).addTo(map);
    const markers = X.settlements.items.map((s) => L.circleMarker([s.lat, s.lon], {
      radius: s.flag ? 8 : s.distance_m <= 1000 ? 6 : 4, color: s.flag ? "#e07a6a" : s.distance_m <= 1000 ? "#e0b45c" : "#6c6b66", weight: 1.5, fillOpacity: 0.85,
    }).bindPopup(`<b>${E.esc(s.name)}</b>${s.name_bn && s.name_bn !== s.name ? ` · <span lang="bn">${E.esc(s.name_bn)}</span>` : ""}<br>${E.esc(s.place)} · ${s.distance_m.toLocaleString("en-US")} m from the ${s.bank} bank<br>bank moved ${s.bank_shift_m == null ? "n/a" : E.signed(s.bank_shift_m, 0, " m")} (river km ${s.river_km})${s.in_river_belt ? "<br>inside the river belt (char)" : ""}${s.flag ? '<br><b style="color:#e07a6a">FLAGGED</b>' : ""}`));
    const places = L.layerGroup(markers).addTo(map);
    map.fitBounds(L.latLngBounds(X.overlay.bounds), { padding: [20, 20] });
    map.setMaxBounds(L.latLngBounds(X.overlay.bounds).pad(0.8));
    const lay = { change, banks, places };
    const simLay = L.layerGroup().addTo(map);
    const shiftLine = (line, dir, adv) => line.map(([la, lo]) => [la, lo + (dir * adv) / (111320 * Math.cos(la * Math.PI / 180))]);
    const drawSimBanks = (adv) => {
      simLay.clearLayers(); if (!adv) return;
      [["west", -1], ["east", 1]].forEach(([k, dir]) => {
        const a = X.banklines.after[k], b = shiftLine(a, dir, adv);
        L.polygon(a.concat(b.slice().reverse()), { stroke: false, fillColor: "#e05a6e", fillOpacity: 0.55, interactive: false }).addTo(simLay);
        L.polyline(b, { color: "#b9a3e6", weight: 2.5, dashArray: "6 4", interactive: false }).addTo(simLay);
      });
    };
    $("#ew-sim").outerHTML = EROSION_PANEL;
    const sms = smsPhone($("#ew-sms"));
    const nearest = X.settlements.items.slice().sort((p, q) => p.distance_m - q.distance_m)[0];
    // ---- Current state vs Simulate
    const thrShift = Math.max(2 * X.method.noise_m, X.method.resolution_m);
    const baseVerdict = $("#ew-verdict").innerHTML, baseKpis = $("#ew-kpis").innerHTML;
    const style = (mk, st) => mk.setStyle(st === "reached" ? { color: "#ff5a4a", radius: 10, weight: 3, fillOpacity: 1 } : st === "flag" ? { color: "#e07a6a", radius: 8, weight: 2, fillOpacity: 0.9 } : st === "watch" ? { color: "#e0b45c", radius: 6, weight: 1.5, fillOpacity: 0.85 } : { color: "#6c6b66", radius: 4, weight: 1.5, fillOpacity: 0.85 });
    const realTable = () => $("#ew-table").innerHTML;
    let savedTable = null;
    const applyScenario = (adv) => {
      $("#ew-adv-out").textContent = `${adv} m`;
      const res = X.settlements.items.map((s) => {
        const shift = (s.bank_shift_m || 0) + adv, left = s.distance_m - adv;
        const st = left <= 0 && s.distance_m <= 2000 ? "reached" : s.distance_m <= 2000 && shift > thrShift ? "flag" : s.distance_m <= 1000 ? "watch" : "none";
        return { s, st, shift, left };
      });
      res.forEach((r, i) => style(markers[i], r.st));
      const reached = res.filter((r) => r.st === "reached"), fl = res.filter((r) => r.st === "flag" || r.st === "reached");
      $("#ew-verdict").innerHTML = `<div class="pn" style="padding:18px 20px;border-color:rgba(185,163,230,.55)"><span class="lbl" style="margin:0 0 6px">Simulated state · +${adv} m advance</span>
        <div style="font:400 26px/1.15 var(--serif)">${fl.length} settlement${fl.length === 1 ? "" : "s"} flagged${reached.length ? `, ${reached.length} reached` : ""}</div>
        <p class="mu" style="margin:6px 0 0;font-size:13px">${reached.length ? "Reached = the hypothetical bank line passes the settlement point: " + reached.slice(0, 5).map((r) => E.esc(r.s.name)).join(", ") + (reached.length > 5 ? "…" : "") : "No settlement reached by the hypothetical bank line."}</p></div>`;
      const body = $("#ew-table tbody");
      if (body) body.innerHTML = res.slice(0, 40).map((r, i) => `<tr${r.st === "reached" || r.st === "flag" ? ' class="current"' : ""}><td class="num" style="text-align:left">${i + 1}</td><td><b>${E.esc(r.s.name)}</b></td><td class="fa">${E.esc(r.s.place)}</td><td class="num">${Math.max(0, r.left).toLocaleString("en-US")} m <span class="fa">left</span></td><td class="fa">${r.s.bank}</td><td class="num" style="color:var(--bad)">${E.signed(r.shift, 0, " m")}</td><td>${r.st === "reached" ? '<span class="tag" style="color:#ff5a4a">REACHED · SIM</span>' : r.st === "flag" ? '<span class="tag" style="color:var(--bad)">FLAGGED · SIM</span>' : r.st === "watch" ? '<span class="tag" style="color:var(--warn)">WATCH</span>' : '<span class="fa">—</span>'}</td></tr>`).join("");
      setStatus({ flagged: fl.length });
      // all key numbers follow the scenario: extra land lost = advance × both banks
      const extraKm2 = (adv * 2 * X.bankLengthKm) / 1000;
      const [[bs, bw], [bn, be]] = X.overlay.bounds, sceneKm2 = Math.abs(be - bw) * 111.32 * Math.cos(((bs + bn) / 2) * Math.PI / 180) * Math.abs(bn - bs) * 111.32;
      const waterSim = X.water.afterPct + (100 * extraKm2) / sceneKm2;
      const medSim = (X.shift.west.mean + X.shift.east.mean) / 2 + adv;
      const near = res.filter((r) => r.left <= 1000).length;
      const sk = (name, v, unit, sub) => `<div class="kpi"><span class="k"><span>${name}</span><span class="tag tag-sim">SIM</span></span><span class="v" style="color:var(--sim)">${E.esc(v)}${unit ? `<small>${unit}</small>` : ""}</span><span class="d">${sub}</span></div>`;
      $("#ew-kpis").innerHTML =
        sk("River water", `${X.water.beforePct.toFixed(1)} → ${waterSim.toFixed(1)}`, "%", `+${(waterSim - X.water.afterPct).toFixed(2)} pts from scenario`) +
        sk("Land lost to river", (X.area.landLostKm2 + extraKm2).toFixed(1), "km²", `+${extraKm2.toFixed(1)} km² from scenario`) +
        sk("Land gained", X.area.landGainedKm2.toFixed(1), "km²", "unchanged") +
        sk("Median bank move", E.signed(medSim, 0), "m", `+${adv} m scenario advance`) +
        sk("Settlements ≤ 1 km", String(near), "", "distance left after the advance") +
        sk("Flagged", String(fl.length), "", `${reached.length} reached`);
      drawProfile(adv); drawArea(extraKm2); drawSimBanks(adv);
      const warn = reached.length > 0 || adv >= 500;
      if (nearest) $("#ew-diag").innerHTML = erosionDiag(adv, nearest.distance_m, nearest.name);
      sms(warn ? SMS_BN : null, "bn", warn ? `Emergency SMS sent to all registered phones in: ${(reached.length ? reached : fl).slice(0, 4).map((r) => r.s.name).join(", ")}` : "");
      if (warn) showAlert(reached.length ? `River reaches ${reached.length} settlement${reached.length > 1 ? "s" : ""}` : "HIGH erosion risk — Jamuna", `Bank advance +${adv} m on the Jamuna. First affected: ${(reached.length ? reached : fl).slice(0, 3).map((r) => r.s.name).join(", ")}. Sending emergency SMS to all registered phones nearby.`);
      else hideAlert(false);
    };
    const setMode = (m) => {
      $$("#ew-mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
      $("#ew-sim").hidden = m !== "simulate";
      setStatus({ mode: m });
      resetAlert();
      if (m === "simulate") { if (savedTable == null) savedTable = realTable(); applyScenario(Number($("#ew-adv").value)); }
      else {
        $("#ew-verdict").innerHTML = baseVerdict; $("#ew-kpis").innerHTML = baseKpis; drawProfile(0); drawArea(0); drawSimBanks(0); sms(null);
        if (savedTable != null) $("#ew-table").innerHTML = savedTable;
        X.settlements.items.forEach((s, i) => style(markers[i], s.flag ? "flag" : s.distance_m <= 1000 ? "watch" : "none"));
        setStatus({ flagged: X.settlements.flagged });
      }
    };
    $$("#ew-mode button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("#ew-adv").addEventListener("input", (e) => applyScenario(Number(e.target.value)));
    $$("[data-adv]").forEach((b) => b.addEventListener("click", () => { $("#ew-adv").value = b.dataset.adv; resetAlert(); applyScenario(Number(b.dataset.adv)); }));

    $$("#ew-layers button").forEach((b) => b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      if (on) lay[b.dataset.l].addTo(map); else map.removeLayer(lay[b.dataset.l]);
    }));
    $("#ew-legend").innerHTML = `<div class="row" style="gap:18px;font-size:12px;color:var(--mu)">
      <span><span class="legend-sw" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#e07a6a;vertical-align:-2px;margin-right:6px"></span>Land lost (land → water)</span>
      <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#86c9a0;vertical-align:-2px;margin-right:6px"></span>Land gained (water → land)</span>
      <span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:rgba(110,195,212,.5);vertical-align:-2px;margin-right:6px"></span>Water both dates</span>
      <span><span style="display:inline-block;width:18px;border-top:2px dashed #a09f98;vertical-align:3px;margin-right:6px"></span>Banks ${E.esc(d0)}</span>
      <span><span style="display:inline-block;width:18px;border-top:2px solid #d4b483;vertical-align:3px;margin-right:6px"></span>Banks ${E.esc(d1)}</span>
      <span>● flagged &nbsp;● ≤ 1 km &nbsp;● other settlement</span></div>`;

    // ---- bank movement profile
    const P = X.profile, pts = (arr) => P.river_km.map((x, i) => ({ x, y: arr[i] }));
    const nz = X.method.noise_m;
    function drawProfile(adv = 0) {
    const shifted = (arr) => P.river_km.map((x, i) => ({ x, y: arr[i] == null ? null : arr[i] + adv }));
    $("#ew-profile").innerHTML = E.lineChart({ series: [
      { name: "west bank", color: "#6ec3d4", noDots: true, points: pts(P.west_m) },
      { name: "east bank", color: "#d4b483", noDots: true, points: pts(P.east_m) },
      ...(adv ? [{ name: `west · scenario +${adv} m`, color: "#b9a3e6", dash: true, noDots: true, points: shifted(P.west_m) }, { name: `east · scenario +${adv} m`, color: "#e58fb4", dash: true, noDots: true, points: shifted(P.east_m) }] : []),
      { name: `+noise (${nz} m)`, color: "#6c6b66", dash: true, noDots: true, points: [{ x: P.river_km[0], y: nz }, { x: P.river_km[P.river_km.length - 1], y: nz }] },
      { name: "−noise", color: "#6c6b66", dash: true, noDots: true, points: [{ x: P.river_km[0], y: -nz }, { x: P.river_km[P.river_km.length - 1], y: -nz }] },
    ], title: "", xLabel: "distance down the study reach (km)", yLabel: "bank move (m)", H: 260, W: 820 }) +
      `<p class="cap">+ = bank moved outward into the floodplain (land lost) · − = inward (land re-emerging) · ${X.method.smoothing} · ${X.method.rejectedJumps} channel-switch jumps (&gt; 1 km) excluded</p>`;
    }
    drawProfile(0);

    // ---- area bars
    function drawArea(extra = 0) {
    const lost = X.area.landLostKm2 + extra, net = lost - X.area.landGainedKm2;
    const mx = Math.max(lost, X.area.landGainedKm2, 1), bar = (lab, v, c) => `<div style="margin-bottom:18px"><div class="row" style="justify-content:space-between"><span class="mu">${lab}</span><span style="font:400 28px var(--serif)">${v.toFixed(1)}<small style="font:13px var(--sans);color:var(--fa)"> km²</small></span></div><div style="height:10px;border-radius:6px;background:var(--bg-2);overflow:hidden"><div style="width:${(100 * v / mx).toFixed(1)}%;height:100%;background:${c};border-radius:6px"></div></div></div>`;
    $("#ew-area").innerHTML = bar(extra ? "Land lost · scenario" : "Land lost to the river", lost, extra ? "#b9a3e6" : "#e07a6a") + bar("Land gained from the river", X.area.landGainedKm2, "#86c9a0") +
      `<dl class="kv" style="margin-top:6px"><dt>Net</dt><dd>${E.signed(net, 1, " km²")} ${net < 0 ? "(recession)" : "(expansion)"}</dd><dt>River belt analysed</dt><dd>${X.area.beltKm2.toFixed(0)} km² · ${X.bankLengthKm} km of banks</dd><dt>Water threshold</dt><dd>${X.method.thresholdDb} dB (histogram valley)</dd></dl>`;
    }
    drawArea(0);

    // ---- settlements table
    $("#ew-rule").textContent = X.method.flagRule;
    const top = X.settlements.items.slice(0, 40);
    $("#ew-table").innerHTML = `<table class="data"><thead><tr><th>#</th><th>Settlement</th><th>Type</th><th class="num">Distance to bank</th><th>Bank</th><th class="num">Bank moved</th><th>Status</th></tr></thead><tbody>${top.map((s, i) => `<tr${s.flag ? ' class="current"' : ""}>
      <td class="num" style="text-align:left">${i + 1}</td><td><b>${E.esc(s.name)}</b>${s.name_bn && s.name_bn !== s.name ? ` <span class="fa" lang="bn">${E.esc(s.name_bn)}</span>` : ""}${s.in_river_belt ? ' <span class="fa">· char</span>' : ""}</td>
      <td class="fa">${E.esc(s.place)}</td><td class="num">${s.distance_m.toLocaleString("en-US")} m</td><td class="fa">${s.bank}</td>
      <td class="num" style="color:${(s.bank_shift_m || 0) > nz ? "var(--bad)" : (s.bank_shift_m || 0) < -nz ? "var(--ok)" : "var(--mu)"}">${s.bank_shift_m == null ? "—" : Math.abs(s.bank_shift_m) <= nz ? '<span class="fa">within noise</span>' : E.signed(s.bank_shift_m, 0, " m")}</td>
      <td>${s.flag ? '<span class="tag" style="color:var(--bad)">FLAGGED</span>' : s.distance_m <= 1000 ? '<span class="tag" style="color:var(--warn)">WATCH</span>' : '<span class="fa">—</span>'}</td></tr>`).join("")}</tbody></table>
      <p class="cap" style="padding:0 20px 14px">${X.settlements.count} named places · ${E.esc(X.settlements.source)} · ${E.esc(X.settlements.attribution)}</p>`;

    // ---- method
    const M = X.method;
    $("#ew-method").innerHTML = `<div class="g" style="margin:0"><div class="c6"><dl class="kv">
      <dt>Before</dt><dd class="mono">${E.esc(X.before.granule)}</dd><dt>After</dt><dd class="mono">${E.esc(X.after.granule)}</dd>
      <dt>Resolution</dt><dd>${M.resolution_m} m (10 m aggregated 2×2)</dd><dt>Speckle filter</dt><dd>${E.esc(M.speckleFilter)}</dd>
      <dt>Water</dt><dd>${M.thresholdDb} dB · ${E.esc(M.thresholdMethod)} (water ${M.waterModeDb} dB, land ${M.landModeDb} dB)</dd>
      <dt>River belt</dt><dd>${E.esc(M.corridor)}</dd><dt>Noise</dt><dd>±${M.noise_m} m (robust spread, ≥ 1 pixel)</dd></dl></div>
      <div class="c6"><p class="lbl">Limits</p><ul class="bullets"><li>${E.esc(X.caveat)}</li><li>Bank lines are the outermost water of the river belt per image row — braided channels and sandbars can shift them.</li><li>Settlement points are OpenStreetMap node locations, not household footprints.</li><li>No field validation yet; next step is comparison with OPERA DSWx and local reports.</li></ul></div></div>`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    E = window.ES;
    if (!E) return;
    initStatusBar();
    const page = document.body.dataset.page;
    if (page === "landing") initLanding();
    if (page === "observe") initObserve();
    if (page === "observe" || page === "bangladesh") initAct();
    if (page === "erosion") initErosion();
  });
})();
