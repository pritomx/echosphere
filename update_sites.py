#!/usr/bin/env python3
"""
EchoSphere — one-command refresh of every site from the newest NISAR passes.

For each site: ask NASA CMR for GCOV granules over the site, keep only passes
whose footprint covers ≥ 90% of the site, pick the track with the newest two such
passes, stream just the site window (fetch_nisar_subset.py), then rebuild the
manifest (process_nisar.py) and the Jamuna erosion analysis (erosion_watch.py).

The Earthdata token comes from the EARTHDATA_TOKEN environment variable (a GitHub
Secret in CI) or ~/.earthdata_token locally. It is never written to the project.

    python update_sites.py
"""
from __future__ import annotations

import collections
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITES = {
    "jamuna": (89.45, 24.25, 89.95, 24.85),        # Jamuna River, Bangladesh — char islands, bank erosion
    "kosi": (86.55, 25.9, 86.95, 26.3),            # Kosi River, Bihar, India — recurrent floods
    "shire": (34.9, -16.75, 35.3, -16.35),         # Lower Shire, Chikwawa–Nsanje, Malawi — cyclone floods
    "beledweyne": (45.05, 4.55, 45.35, 4.9),       # Shabelle River, Beledweyne, Somalia — river floods
}
PASSES = 2  # two dates on the same track are enough for change detection


def pip(lat, lon, ring):
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        (ya, xa), (yb, xb) = ring[i], ring[j]
        if (ya > lat) != (yb > lat) and lon < (xb - xa) * (lat - ya) / (yb - ya) + xa:
            inside = not inside
        j = i
    return inside


def pick(bbox):
    w, s, e, n = bbox
    url = ("https://cmr.earthdata.nasa.gov/search/granules.json?provider=ASF&short_name=NISAR_L2_GCOV_PROVISIONAL_V1"
           f"&bounding_box={w},{s},{e},{n}&sort_key=-start_date&page_size=80")
    for attempt in range(4):  # CMR occasionally stalls: retry with back-off
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                entries = json.load(r)["feed"]["entry"]
            break
        except OSError as exc:
            if attempt == 3:
                raise
            print(f"  CMR retry ({exc})", flush=True)
            time.sleep(10 * (attempt + 1))
    tracks = collections.defaultdict(list)
    for x in entries:
        t = x["producer_granule_id"].split("_")
        v = list(map(float, x["polygons"][0][0].split()))
        ring = list(zip(v[0::2], v[1::2]))
        cov = sum(pip(s + (i + .5) / 10 * (n - s), w + (j + .5) / 10 * (e - w), ring) for i in range(10) for j in range(10))
        h5 = next((l["href"] for l in x["links"] if l["href"].endswith(".h5")), None)
        if cov >= 100 and h5:  # whole area inside the frame, so the processed image has no empty corner
            tracks[(t[5], t[6], t[7], t[8])].append((x["time_start"], h5))
    good = {}
    for k, v in tracks.items():  # one granule per acquisition date (a pass can be published in two variants)
        seen, uniq = set(), []
        for t, h5 in sorted(v, reverse=True):
            if t[:10] not in seen:
                seen.add(t[:10]); uniq.append((t, h5))
        if len(uniq) >= PASSES:
            good[k] = uniq[:PASSES]
    if not good:
        return []
    best = max(good, key=lambda k: good[k][0][0])  # track with the most recent full-coverage pass
    return [h5 for _, h5 in good[best]]


def run(*cmd):
    print("$", " ".join(cmd), flush=True)
    subprocess.run([sys.executable, *cmd], cwd=ROOT, check=True)


def main():
    raw = ROOT / "data" / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    for site, bbox in SITES.items():
        urls = pick(bbox)
        if not urls:
            print(f"{site}: no pair of full-coverage passes found — keeping previous results")
            continue
        wanted = {Path(u).stem for u in urls}
        for old in raw.glob(f"*__SUBSET_{site}.h5"):  # keep only the newest pair per site
            if old.name.split("__SUBSET_")[0] not in wanted:
                old.unlink()
        todo = [u for u in urls if not (raw / f"{Path(u).stem}__SUBSET_{site}.h5").exists()]
        print(f"{site}: {len(urls)} passes selected, {len(todo)} to fetch")
        if todo:
            try:  # "--bbox=" form: west longitudes start with "-" and would look like an option
                run("fetch_nisar_subset.py", "--bbox=" + ",".join(map(str, bbox)), "--site", site, *todo)
            except subprocess.CalledProcessError as exc:
                print(f"{site}: fetch failed ({exc.returncode}) — keeping previous results, continuing", flush=True)
    run("process_nisar.py")
    run("erosion_watch.py")
    run("build_examples.py")   # examples show the freshly processed full-coverage scenes


if __name__ == "__main__":
    main()
