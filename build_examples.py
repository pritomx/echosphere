#!/usr/bin/env python3
"""
Rebuild data/examples.js from the processed NISAR results in data/manifest.js.

Each example area gets its latest and previous GCOV scene as full-coverage images
(backscatter + detected water) with calibrated open-water numbers, so the example
views match the Observe tab exactly. Other fields already saved for the example
(pass list, rainfall, places) are kept.

    python build_examples.py
"""
import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXAMPLES = {  # must match EXAMPLES in js/monitor.js
    "jamuna": ("Jamuna River, Bangladesh", [89.45, 24.25, 89.95, 24.85]),
    "kosi": ("Kosi River, Bihar, India", [86.55, 25.9, 86.95, 26.3]),
    "shire": ("Lower Shire, Malawi", [34.9, -16.75, 35.3, -16.35]),
    "beledweyne": ("Beledweyne, Somalia", [45.05, 4.55, 45.35, 4.9]),
}


def load_js(path, var):
    txt = path.read_text(encoding="utf-8")
    m = re.search(rf"const {var} = (.*?);\n", txt, re.S)
    return json.loads(m.group(1)) if m else None


def main():
    recs = load_js(ROOT / "data" / "manifest.js", "NISAR_MANIFEST") or []
    ex_path = ROOT / "data" / "examples.js"
    saved = (load_js(ex_path, "EXAMPLE_DATA") or {}) if ex_path.exists() else {}
    out = {}
    for key, (name, bbox) in EXAMPLES.items():
        def inside(r):
            (s, w), (n, e) = r["bounds"]
            lat, lon = (s + n) / 2, (w + e) / 2
            return bbox[1] <= lat <= bbox[3] and bbox[0] <= lon <= bbox[2]
        scenes = sorted((r for r in recs if r.get("product") == "GCOV" and inside(r)), key=lambda r: r["datetime"])
        base = dict(saved.get(key) or {})
        base.update({"v": 1, "key": key, "name": name, "bbox": bbox})
        if scenes:
            def shot(r):
                return {"date": r["date"], "img": r["overlay"], "imgWater": r.get("waterOverlay"), "bounds": r["bounds"],
                        "coverage": 100.0, "water": r["stats"]["openWaterPercent"], "granule": r["granule"], "processed": True}
            after, before = scenes[-1], (scenes[-2] if len(scenes) > 1 else None)
            base["after"], base["before"] = shot(after), (shot(before) if before else None)
            base["lastPass"] = max(base.get("lastPass") or "", after["date"]) or after["date"]
            base["source"] = "processed NISAR GCOV (full resolution)"
        base.setdefault("thresholds", {"rise": 20, "rain": 100})
        base["savedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        out[key] = base
        a = base.get("after")
        print(f"{key:11s} {a['date'] if a else '-'} vs {base['before']['date'] if base.get('before') else '-'} · water {a['water'] if a else '-'}%")
    ex_path.write_text("// Saved example areas — rebuilt by build_examples.py from processed NISAR scenes.\nconst EXAMPLE_DATA = " + json.dumps(out) + ";\n", encoding="utf-8")


if __name__ == "__main__":
    main()
