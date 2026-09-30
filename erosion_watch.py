#!/usr/bin/env python3
"""
EchoSphere — Jamuna Erosion Watch
=================================
Compares two real NISAR GCOV scenes of the same track (data/raw/*jamuna.h5)
and answers one question:

    "Where did the river's banks move, by how many metres,
     and which settlements are close to a bank that moved toward them?"

Steps (all numbers are computed from the files; nothing is invented):
  1. Load HHHH backscatter (linear), apply the NISAR validity mask.
  2. Aggregate 2×2 (10 m → 20 m) and apply a 5×5 box filter in linear power
     to reduce speckle, then convert to dB.
  3. Water = dB below an Otsu threshold computed from BOTH dates together
     (one threshold, so the two dates are comparable). Small speckle blobs
     are removed with a morphological opening/closing.
  4. River belt ("corridor") = where the 500 m-scale water fraction is high.
     For every image row (the Jamuna runs north→south) the west bank is the
     westernmost water pixel of the belt and the east bank the easternmost.
  5. Bank shift per row = change of bank position between dates, in metres;
     positive = bank moved OUTWARD (land lost), negative = bank moved inward.
     A 1 km running median suppresses noise; the median absolute deviation of
     the raw row-to-row shifts is reported as the noise level.
  6. Land lost / land gained inside the belt (km²) and a change overlay PNG.
  7. Settlements from OpenStreetMap (place=village|town|city) are ranked by
     distance to the latest bank line and the local bank shift toward them.

Outputs: data/erosion.js (loaded by erosion.html with a <script> tag) and
data/processed/erosion_change.png.

Caveat written into the output: two dates 12 days apart cannot separate true
bank erosion from water-level change (inundation/recession). The shifts are a
screening signal for where to look, not a validated erosion measurement.
"""
from __future__ import annotations

import glob
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import h5py
import numpy as np
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject, transform_bounds
from PIL import Image

ROOT = Path(__file__).resolve().parent
RAW, OUT = ROOT / "data" / "raw", ROOT / "data" / "processed"
BBOX = (89.45, 24.25, 89.95, 24.85)          # W, S, E, N  (Jamuna study window)
AGG = 2                                      # 10 m → 20 m
BOX = 5                                      # speckle box filter (pixels at 20 m)
NEAR_M = 2000                                # settlements within this distance of a bank are assessed


def log(m): print(m, flush=True)


def boxsum(a, r):
    """Sum over a (2r+1)² window using cumulative sums (fast, no SciPy)."""
    p = np.pad(a, ((r + 1, r), (r + 1, r)), mode="constant")
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    return c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]


def load(path):
    g = h5py.File(path, "r")["science/LSAR/GCOV/grids/frequencyA"]
    hh = g["HHHH"][()].astype("float64")
    m = g["mask"][()] if "mask" in g else None
    hh[~np.isfinite(hh) | (hh <= 0)] = np.nan
    if m is not None:
        hh[(m == 0) | (m == 255)] = np.nan
    x, y = g["xCoordinates"][()], g["yCoordinates"][()]
    epsg = int(g["projection"].attrs.get("epsg_code", g["projection"][()]))
    ident = h5py.File(path, "r")["science/LSAR/identification"]
    t = ident["zeroDopplerStartTime"][()].decode()[:19]
    gid = ident["granuleId"][()].decode()
    return hh, x, y, epsg, t, gid


def aggregate(a, k):
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    b = a[:h, :w].reshape(h // k, k, w // k, k)
    return np.nanmean(b, axis=(1, 3))


def to_db_filtered(lin):
    ok = np.isfinite(lin)
    s = boxsum(np.where(ok, lin, 0.0), BOX // 2)
    n = boxsum(ok.astype("float64"), BOX // 2)
    with np.errstate(invalid="ignore", divide="ignore"):
        db = 10 * np.log10(s / n)
    db[~ok] = np.nan
    return db


def valley(values):
    """Threshold at the histogram minimum between the water mode and the land mode (0.5 dB bins, smoothed)."""
    v = values[np.isfinite(values)]
    hist, edges = np.histogram(v, bins=np.arange(-30, 0.5, 0.5))
    mids = (edges[:-1] + edges[1:]) / 2
    sm = np.convolve(hist, np.ones(5) / 5, mode="same")
    wi = np.where((mids > -26) & (mids < -14))[0]; li = np.where((mids >= -14) & (mids < 0))[0]
    wpk, lpk = wi[np.argmax(sm[wi])], li[np.argmax(sm[li])]
    return float(mids[wpk + np.argmin(sm[wpk:lpk + 1])]), float(mids[wpk]), float(mids[lpk])


def otsu(values):
    v = values[np.isfinite(values)]
    v = v[(v > -40) & (v < 5)]
    hist, edges = np.histogram(v, bins=256)
    mids = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist); w1 = w0[-1] - w0
    m0 = np.cumsum(hist * mids) / np.maximum(w0, 1)
    m1 = (np.sum(hist * mids) - np.cumsum(hist * mids)) / np.maximum(w1, 1)
    between = w0 * w1 * (m0 - m1) ** 2
    return float(mids[np.argmax(between)])


def opening_closing(w):
    """Remove isolated speckle (opening r=1) and fill small gaps (closing r=1)."""
    k = 9.0
    er = boxsum(w.astype("float64"), 1) >= k - 0.5
    op = boxsum(er.astype("float64"), 1) > 0.5
    di = boxsum(op.astype("float64"), 1) > 0.5
    return boxsum(di.astype("float64"), 1) >= k - 0.5


def banks(water, corridor):
    """Per row: west and east bank column of the river belt (NaN where undefined)."""
    rows = water.shape[0]
    west = np.full(rows, np.nan); east = np.full(rows, np.nan); centre = np.full(rows, np.nan)
    for r in range(rows):
        cols = np.where(corridor[r])[0]
        if cols.size < 10:
            continue
        # contiguous corridor segments; take the one holding the most water
        breaks = np.where(np.diff(cols) > 1)[0]
        segs = np.split(cols, breaks + 1)
        best = max(segs, key=lambda s: water[r, s].sum())
        wc = best[water[r, best]]
        if wc.size < 3:
            continue
        west[r], east[r], centre[r] = wc.min(), wc.max(), np.median(wc)
    return west, east, centre


def running_median(a, win):
    out = np.full_like(a, np.nan)
    h = win // 2
    for i in range(len(a)):
        s = a[max(0, i - h): i + h + 1]
        s = s[np.isfinite(s)]
        if s.size >= win // 4:
            out[i] = np.median(s)
    return out


def fetch_osm(bbox, cache_dir=OUT, site="jamuna"):
    cache = Path(cache_dir) / f"osm_places_{site}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8")), "OpenStreetMap Overpass API (cached query)"
    w, s, e, n = bbox
    q = f'[out:json][timeout:60];node["place"~"village|hamlet|town|city"]({s},{w},{n},{e});out;'
    req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(),
                                 headers={"User-Agent": "EchoSphere/1.0 (NASA Space Apps 2026)", "Accept": "application/json"})
    for attempt in range(4):  # Overpass is often busy (429/504): back off and retry
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.loads(r.read().decode("utf-8"))
            break
        except OSError as exc:
            if attempt == 3:
                raise
            log(f"  Overpass busy ({exc}); retrying")
            time.sleep(10 * (attempt + 1))
    places = [{"name": el["tags"].get("name:en") or el["tags"].get("name"), "name_bn": el["tags"].get("name:bn") or el["tags"].get("name"),
               "place": el["tags"]["place"], "lat": el["lat"], "lon": el["lon"], "osm_id": el["id"]} for el in d["elements"] if el.get("tags", {}).get("name")]
    cache.write_text(json.dumps(places, ensure_ascii=False), encoding="utf-8")
    return places, "OpenStreetMap Overpass API"


def run(raw_dir=RAW, out_dir=OUT, bbox=BBOX, site="jamuna", overlay_url="data/processed/erosion_change.png", write_js=True):
    """Run the erosion analysis for one site; returns the result dict (raises ValueError if it cannot run)."""
    raw_dir, out_dir = Path(raw_dir), Path(out_dir)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    files = sorted(glob.glob(str(raw_dir / f"*{site}.h5")), key=lambda f: load(f)[4])
    if len(files) < 2:
        raise ValueError(f"need at least two {site} scenes in {raw_dir} to compare")
    f0, f1 = files[-2], files[-1]
    a0, x, y, epsg, t0, g0 = load(f0)
    a1, x1, y1, epsg1, t1, g1 = load(f1)
    if a0.shape != a1.shape or not np.allclose(x, x1) or not np.allclose(y, y1) or epsg != epsg1:
        raise ValueError("scenes are not on the same grid — choose passes from the same track/frame")
    log(f"dates {t0} → {t1} · grid {a0.shape} · EPSG:{epsg}")

    # 1–2: aggregate + speckle filter
    l0, l1 = aggregate(a0, AGG), aggregate(a1, AGG)
    d0, d1 = to_db_filtered(l0), to_db_filtered(l1)
    res = abs(float(x[1] - x[0])) * AGG
    xs, ys = x[: l0.shape[1] * AGG: AGG] + (AGG - 1) * (x[1] - x[0]) / 2, y[: l0.shape[0] * AGG: AGG] + (AGG - 1) * (y[1] - y[0]) / 2
    valid = np.isfinite(d0) & np.isfinite(d1)

    # 3: one Otsu threshold for both dates
    thr, wmode, lmode = valley(np.concatenate([d0[valid], d1[valid]]))
    w0 = opening_closing(valid & (d0 < thr))
    w1 = opening_closing(valid & (d1 < thr))
    log(f"valley threshold {thr:.2f} dB (water mode {wmode:.1f}, land mode {lmode:.1f}) · water {100 * w0.mean():.2f}% → {100 * w1.mean():.2f}%")

    # 4: river belt (union of both dates so the two bank lines are comparable)
    r500 = int(round(500 / res))
    frac = (boxsum(w0.astype("float64"), r500) + boxsum(w1.astype("float64"), r500)) / (2 * (2 * r500 + 1) ** 2)
    corridor = boxsum((frac > 0.20).astype("float64"), int(round(300 / res))) > 0.5
    b0w, b0e, c0 = banks(w0, corridor)
    b1w, b1e, c1 = banks(w1, corridor)
    ncol = w0.shape[1]
    for arr_w, arr_e in ((b0w, b0e), (b1w, b1e)):
        edge = (arr_w <= 2) | (arr_e >= ncol - 3)
        arr_w[edge] = np.nan; arr_e[edge] = np.nan
    # drop bank points that jump > 1 km off the 5 km trend (belt briefly merging with a side wetland)
    w5, lim = int(round(5000 / res)) | 1, 1000 / res
    for arr in (b0w, b0e, b1w, b1e):
        trend = running_median(arr, w5)
        arr[np.abs(arr - trend) > lim] = np.nan

    # 5: bank shift (m); positive = outward (land lost on that side)
    west_raw = (b0w - b1w) * res           # west bank moved further west → positive
    east_raw = (b1e - b0e) * res           # east bank moved further east → positive
    JUMP = 1000.0                          # > 1 km in 12 days = bank tracker switched channel, not erosion
    jumps = int((np.abs(west_raw) > JUMP).sum() + (np.abs(east_raw) > JUMP).sum())
    west_raw[np.abs(west_raw) > JUMP] = np.nan
    east_raw[np.abs(east_raw) > JUMP] = np.nan
    win = int(round(1000 / res)) | 1
    west_s, east_s = running_median(west_raw, win), running_median(east_raw, win)
    both = np.concatenate([west_raw[np.isfinite(west_raw)], east_raw[np.isfinite(east_raw)]])
    noise = max(res, float(np.median(np.abs(both - np.median(both)))) * 1.4826)  # robust spread, floored at one pixel
    rows = np.arange(len(west_raw))
    river_km = (rows * res) / 1000.0  # rows run north → south

    # 6: land lost / gained inside the belt
    lost = corridor & ~w0 & w1
    gained = corridor & w0 & ~w1
    px_km2 = res * res / 1e6
    t_ll = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    t_xy = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)

    # change overlay → Web Mercator PNG
    # class codes start at 1 so 0 is never mistaken for no-data during mode resampling
    cls = np.ones(w0.shape, dtype="uint8")
    cls[corridor & w0 & w1] = 2
    cls[lost] = 3
    cls[gained] = 4
    src_tr = Affine(res, 0, xs[0] - res / 2, 0, -res, ys[0] + res / 2)
    l, b, r_, t = transform_bounds(f"EPSG:{epsg}", "EPSG:3857", xs[0] - res / 2, ys[-1] - res / 2, xs[-1] + res / 2, ys[0] + res / 2)
    W = 1400; H = int(W * (t - b) / (r_ - l))
    dst = np.zeros((H, W), dtype="uint8")
    reproject(cls, dst, src_transform=src_tr, src_crs=CRS.from_epsg(epsg), dst_transform=Affine((r_ - l) / W, 0, l, 0, -(t - b) / H, t), dst_crs=CRS.from_epsg(3857), resampling=Resampling.mode, src_nodata=None, dst_nodata=0)
    rgba = np.zeros((H, W, 4), dtype="uint8")
    rgba[dst == 2] = (110, 195, 212, 120)
    rgba[dst == 3] = (224, 122, 106, 255)
    rgba[dst == 4] = (134, 201, 160, 255)
    out_dir.mkdir(parents=True, exist_ok=True)
    png = out_dir / "erosion_change.png"
    Image.fromarray(rgba, "RGBA").save(png, optimize=True)
    assert png.stat().st_size < 1_000_000, "overlay PNG exceeds 1 MB"
    t_merc = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    (wl, sl), (el, nl) = t_merc.transform(l, b), t_merc.transform(r_, t)

    def line(cols_raw):
        cols = running_median(cols_raw, win)   # display the 1 km-smoothed bank position
        pts = []
        for r in range(0, len(cols), 10):
            if np.isfinite(cols[r]):
                lon, lat = t_ll.transform(xs[int(cols[r])], ys[r])
                pts.append([round(lat, 5), round(lon, 5)])
        return pts

    # 7: settlements
    places, osm_src = fetch_osm(bbox, out_dir, site)
    bank_pts = []
    for side, cols in (("west", b1w), ("east", b1e)):
        for r in range(len(cols)):
            if np.isfinite(cols[r]):
                bank_pts.append((side, r, xs[int(cols[r])], ys[r]))
    bp = np.array([[p[2], p[3]] for p in bank_pts])
    ranked = []
    for pl in places:
        px, py = t_xy.transform(pl["lon"], pl["lat"])
        if not (xs[0] <= px <= xs[-1] and ys[-1] <= py <= ys[0]):
            continue
        d = np.hypot(bp[:, 0] - px, bp[:, 1] - py)
        i = int(np.argmin(d))
        side, row = bank_pts[i][0], bank_pts[i][1]
        rr = int(round((ys[0] - py) / res))
        inside = 0 <= rr < len(b1w) and np.isfinite(b1w[rr]) and np.isfinite(b1e[rr]) and xs[int(b1w[rr])] < px < xs[int(b1e[rr])]
        shift = west_s[row] if side == "west" else east_s[row]
        ranked.append({**pl, "distance_m": round(float(d[i])), "bank": side, "river_km": round(float(river_km[row]), 1),
                       "bank_shift_m": None if not np.isfinite(shift) else round(float(shift)), "in_river_belt": bool(inside)})
    for r in ranked:
        s = r["bank_shift_m"] or 0
        r["flag"] = bool(r["distance_m"] <= NEAR_M and s > max(2 * noise, res))
    ranked.sort(key=lambda r: (not r["flag"], r["distance_m"]))

    def km2(m): return round(float(m.sum() * px_km2), 2)

    def stats(a):
        a = a[np.isfinite(a)]
        return {"mean": round(float(a.mean()), 1), "p10": round(float(np.percentile(a, 10)), 1), "p90": round(float(np.percentile(a, 90)), 1), "max": round(float(a.max()), 1), "min": round(float(a.min()), 1)} if a.size else None

    out = {
        "provenance": "REAL NISAR",
        "site": "Jamuna River, Bangladesh" if site == "jamuna" else site,
        "before": {"datetime": t0, "granule": g0, "file": Path(f0).name},
        "after": {"datetime": t1, "granule": g1, "file": Path(f1).name},
        "intervalDays": round((np.datetime64(t1) - np.datetime64(t0)) / np.timedelta64(1, "D"), 1),
        "method": {"resolution_m": res, "speckleFilter": f"{BOX}x{BOX} box (linear power)", "thresholdDb": round(thr, 2), "thresholdMethod": "histogram valley between water and land modes, both dates combined", "waterModeDb": round(wmode, 1), "landModeDb": round(lmode, 1),
                   "corridor": "500 m water fraction > 20%, dilated 300 m", "smoothing": f"{win * res / 1000:.1f} km running median", "noise_m": round(noise, 1), "rejectedJumps": jumps, "jumpLimit_m": 1000,
                   "flagRule": f"settlement ≤ {NEAR_M} m from latest bank AND local outward shift > max(2×noise, {res:.0f} m)"},
        "water": {"beforePct": round(100 * float(w0[valid].mean()), 2), "afterPct": round(100 * float(w1[valid].mean()), 2)},
        "area": {"landLostKm2": km2(lost), "landGainedKm2": km2(gained), "netKm2": round(km2(lost) - km2(gained), 2), "beltKm2": km2(corridor)},
        "bankLengthKm": round(float(np.isfinite(west_s).sum() * res / 1000), 1),
        "shift": {"west": stats(west_s), "east": stats(east_s)},
        "profile": {"river_km": [round(float(v), 2) for v in river_km[::5]], "west_m": [None if not np.isfinite(v) else round(float(v), 1) for v in west_s[::5]], "east_m": [None if not np.isfinite(v) else round(float(v), 1) for v in east_s[::5]]},
        "banklines": {"before": {"west": line(b0w), "east": line(b0e)}, "after": {"west": line(b1w), "east": line(b1e)}},
        "overlay": {"path": overlay_url, "bounds": [[round(sl, 6), round(wl, 6)], [round(nl, 6), round(el, 6)]], "bytes": png.stat().st_size},
        "settlements": {"source": osm_src, "attribution": "© OpenStreetMap contributors", "count": len(ranked), "flagged": sum(r["flag"] for r in ranked), "items": ranked},
        "caveat": "Two dates 12 days apart cannot separate bank erosion from water-level change. Shifts are a screening signal for where to look, not a validated erosion measurement.",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if write_js:
        (ROOT / "data" / "erosion.js").write_text("// AUTO-GENERATED by erosion_watch.py from real NISAR files — do not edit.\nconst EROSION = " + json.dumps(out, ensure_ascii=False) + ";\n", encoding="utf-8")
    log(f"land lost {out['area']['landLostKm2']} km² · gained {out['area']['landGainedKm2']} km² · noise {noise:.1f} m")
    log(f"west shift {out['shift']['west']} · east shift {out['shift']['east']}")
    log(f"settlements {len(ranked)} · flagged {out['settlements']['flagged']} · top: {[(r['name'], r['distance_m'], r['bank_shift_m']) for r in ranked[:6]]}")
    return out


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        run()
    except ValueError as exc:
        log(str(exc)); return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
