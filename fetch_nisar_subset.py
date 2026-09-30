#!/usr/bin/env python3
"""
EchoSphere — fetch a site-sized subset of a real NISAR L2 HDF5 granule
======================================================================
NISAR GCOV granules are several GB each. This tool streams ONLY the bytes it
needs (HTTP range requests) from the real file at NASA ASF, crops the science
layers to a bounding box, and writes a small, honest subset file to data/raw/.

The subset keeps the original /science/<band>/identification metadata (granule
id, acquisition times, product type) and records where it came from, so
process_nisar.py can process it as REAL NISAR data.

Authentication: an Earthdata Login bearer token is read from the environment
variable EARTHDATA_TOKEN or from ~/.earthdata_token. It is never written into
the project and never printed.

Usage:
    python fetch_nisar_subset.py --inspect URL
    python fetch_nisar_subset.py --bbox W,S,E,N --site jamuna URL [URL ...]
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
BLOCK = 1024 * 1024              # bytes per HTTP range request (block cache unit)
CACHE_BLOCKS = 1200             # up to ~1.2 GB kept in memory while subsetting
TERMS = ("HHHH", "HVHV", "mask")  # co-pol (water/change) + cross-pol + validity mask
WORKERS = 8                      # parallel range requests


def token() -> str:
    t = os.environ.get("EARTHDATA_TOKEN")
    if not t:
        p = Path.home() / ".earthdata_token"
        if p.exists():
            t = p.read_text(encoding="utf-8").strip()
    if not t:
        sys.exit("No Earthdata token: set EARTHDATA_TOKEN or create ~/.earthdata_token")
    return t


def resolve(url: str, tok: str) -> tuple[str, int]:
    """Follow the ASF redirect once (with the token) to a pre-signed URL; return it and the file size."""
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}", "Range": "bytes=0-0"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.geturl(), int(r.headers["Content-Range"].split("/")[-1])
        except OSError as exc:  # DNS hiccup / timeout: wait and retry
            if attempt == 4:
                raise
            print(f"    retry connect: {exc}", flush=True)
            time.sleep(5 * (attempt + 1))


class HTTPRangeFile(io.RawIOBase):
    """Read-only, seekable file object backed by HTTP range requests with a block cache."""

    def __init__(self, url: str, size: int):
        self.url, self.size, self.pos = url, size, 0
        self.cache: OrderedDict[int, bytes] = OrderedDict()
        self.fetched = 0
        self.requests = 0
        self.lock = threading.Lock()

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _block(self, i: int) -> bytes:
        with self.lock:
            if i in self.cache:
                self.cache.move_to_end(i)
                return self.cache[i]
        start, end = i * BLOCK, min(self.size, (i + 1) * BLOCK) - 1
        for attempt in range(4):
            try:
                req = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                break
            except OSError as exc:  # transient network error: back off and retry
                if attempt == 3:
                    raise
                print(f"    retry block {i}: {exc}", flush=True)
                time.sleep(2 * (attempt + 1))
        with self.lock:
            self.fetched += len(data)
            self.requests += 1
            self.cache[i] = data
            if len(self.cache) > CACHE_BLOCKS:
                self.cache.popitem(last=False)
        return data

    def prefetch(self, ranges):
        """Download the blocks covering (offset, size) byte ranges, WORKERS at a time."""
        blocks = sorted({i for off, size in ranges for i in range(off // BLOCK, (off + size - 1) // BLOCK + 1)} - set(self.cache))
        with ThreadPoolExecutor(WORKERS) as pool:
            list(pool.map(self._block, blocks))
        return len(blocks)

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        out, p = memoryview(b), self.pos
        done = 0
        while done < n:
            i, off = divmod(p + done, BLOCK)
            blk = self._block(i)
            take = min(n - done, len(blk) - off)
            out[done:done + take] = blk[off:off + take]
            done += take
        self.pos += n
        return n


def open_remote(url: str):
    import h5py
    final, size = resolve(url, token())
    f = HTTPRangeFile(final, size)
    return h5py.File(io.BufferedReader(f, buffer_size=BLOCK), "r"), f, size


def inspect(url: str):
    import h5py
    h5, raw, size = open_remote(url)
    print(f"file size {size / 1e9:.2f} GB")

    def show(name, obj):
        if isinstance(obj, h5py.Dataset) and ("identification" in name or "/grids/" in name) and name.count("/") <= 6:
            print(f"  {name}  {obj.shape} {obj.dtype} chunks={obj.chunks} comp={obj.compression}")
    h5.visititems(show)
    print(f"read {raw.fetched / 1e6:.1f} MB in {raw.requests} requests")


def subset(url: str, bbox: tuple[float, float, float, float], site: str) -> Path:
    import h5py
    import numpy as np
    from pyproj import Transformer

    h5, raw, size = open_remote(url)
    band = next(b for b in ("LSAR", "SSAR") if f"science/{b}" in h5)
    ident = f"science/{band}/identification"
    granule = h5[ident]["granuleId"][()].decode() if "granuleId" in h5[ident] else Path(url).stem
    grid = f"science/{band}/GCOV/grids/frequencyA"
    if grid not in h5:
        raise SystemExit(f"{Path(url).name}: no {grid} (only GCOV subsetting is implemented)")
    g = h5[grid]
    x, y = g["xCoordinates"][()], g["yCoordinates"][()]
    proj = g["projection"]
    epsg = int(proj.attrs.get("epsg_code", proj[()]))

    # --- bounding box (lon/lat) → pixel window in the product's map projection
    tr = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    w, s, e, n = bbox
    xs, ys = tr.transform([w, e, w, e], [s, s, n, n])
    cols = np.where((x >= min(xs)) & (x <= max(xs)))[0]
    rows = np.where((y >= min(ys)) & (y <= max(ys)))[0]
    if not len(cols) or not len(rows):
        raise SystemExit(f"{Path(url).name}: bbox does not intersect this granule")
    r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    print(f"  {granule}\n  EPSG:{epsg} window rows {r0}:{r1} cols {c0}:{c1} ({r1 - r0}×{c1 - c0} px of {g['xCoordinates'].shape[0]} cols)")

    RAW.mkdir(parents=True, exist_ok=True)
    out = RAW / f"{granule}__SUBSET_{site}.h5"
    t0 = time.time()
    with h5py.File(out, "w") as o:
        h5.copy(h5[ident], o.require_group(f"science/{band}"), name="identification")
        og = o.require_group(grid)
        og["xCoordinates"] = x[c0:c1]
        og["yCoordinates"] = y[r0:r1]
        for k, v in g["xCoordinates"].attrs.items(): og["xCoordinates"].attrs[k] = v
        for k, v in g["yCoordinates"].attrs.items(): og["yCoordinates"].attrs[k] = v
        op = og.create_dataset("projection", data=proj[()])
        for k, v in proj.attrs.items(): op.attrs[k] = v
        kept = []
        for term in TERMS:
            if term in g:
                d = g[term]
                # Look up the byte location of every chunk in the window and fetch them in parallel first.
                cr, cc = d.chunks
                ranges = []
                for rr in range(r0 - r0 % cr, r1, cr):
                    for c in range(c0 - c0 % cc, c1, cc):
                        info = d.id.get_chunk_info_by_coord((rr, c))
                        if info.byte_offset is not None and info.size:
                            ranges.append((info.byte_offset, info.size))
                nb = raw.prefetch(ranges)
                print(f"    {term}: {len(ranges)} chunks · {sum(x[1] for x in ranges) / 1e6:.0f} MB compressed · {nb} blocks fetched", flush=True)
                arr = d[r0:r1, c0:c1]
                od = og.create_dataset(term, data=arr, compression="gzip", compression_opts=4, chunks=True)  # keeps dtype (float32 / uint8 mask)
                for k, v in d.attrs.items(): od.attrs[k] = v
                kept.append(term)
        o.attrs["echosphere_subset_of"] = Path(url).name
        o.attrs["echosphere_subset_source_url"] = url
        o.attrs["echosphere_subset_bbox_lonlat"] = np.array(bbox)
        o.attrs["echosphere_subset_window_rows_cols"] = np.array([r0, r1, c0, c1])
        o.attrs["echosphere_subset_created_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"  kept {kept} · streamed {raw.fetched / 1e6:.0f} MB of {size / 1e9:.2f} GB in {raw.requests} requests · {time.time() - t0:.0f} s")
    print(f"  → {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.1f} MB)")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("urls", nargs="+")
    ap.add_argument("--inspect", action="store_true", help="list datasets only")
    ap.add_argument("--bbox", help="W,S,E,N in degrees")
    ap.add_argument("--site", default="site")
    a = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    for u in a.urls:
        print(f"→ {Path(u).name}")
        if a.inspect:
            inspect(u)
        else:
            if not a.bbox:
                sys.exit("--bbox W,S,E,N is required")
            subset(u, tuple(float(v) for v in a.bbox.split(",")), a.site)


if __name__ == "__main__":
    main()
