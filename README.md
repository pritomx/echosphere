# EchoSphere

**Listening to Earth change through radar.**
Team THEIA · NASA Space Apps Challenge 2026 · *Dancing with the SARs*

EchoSphere is a lightweight web application. It shows how repeated **NASA-ISRO NISAR** radar observations can reveal flooding, erosion, deformation and glacier motion, including when clouds or darkness block optical imagery.

Every value is labelled with exactly one provenance state:

| Label | Meaning |
|---|---|
| **REAL NISAR** | Computed by `process_nisar.py` from a NISAR HDF5 file that *is* put in `data/raw/` |
| **DEMO** | Synthetic, illustrative scenario (`js/locations.js`). Not a NASA/NISAR observation |
| **SIMULATED** | Prototype parts: risk rules, rainfall context, SMS gateway, phone message |
| **LIVE NASA** | Real data fetched at view time from public NASA APIs (no key). This is catalog metadata, imagery tiles or rainfall, not locally processed HDF5 |

## Live NASA data (`js/live.js`)

All of these are keyless and CORS-enabled, so they work when `index.html` is opened directly:

| Source | Used for |
|---|---|
| NASA CMR (`cmr.earthdata.nasa.gov`) | real NISAR L2 GCOV/GUNW/GOFF granules over each site (PROVISIONAL + BETA): counts, timeline, orbit/polarization/maturity split, footprints, `.h5` download links |
| NASA GIBS (`gibs.earthdata.nasa.gov`) | map layers: NISAR GCOV false-colour imagery, OPERA DSWx-S1 surface water, GPM IMERG precipitation. Also a dark-pixel fraction series computed from the NISAR tiles (a visual proxy, not calibrated backscatter) |
| Open-Meteo (`api.open-meteo.com`, not NASA) | 16-day rain/temperature forecast for the Forecast tab |
| NASA POWER (`power.larc.nasa.gov`) | daily precipitation and 72-h sums for Jamuna. It can feed the SIMULATED rule engine (POWER is MERRA-2 based, not IMERG) |

Offline, these panels show "Live API unavailable" and everything else keeps working. The `.h5` download links need an Earthdata login. Save the files to `data/raw/` and run `process_nisar.py` to get full **REAL NISAR** processing.

## Requirements

- Python 3.10+ (only needed to process real NISAR files)
- A modern web browser
- An internet connection for the Leaflet library, the basemap tiles and the web fonts. The dashboards still work without one, but the map background will be blank.

## Installation

```bash
cd echosphere
python -m venv .venv
```

Activate the environment:

```bash
# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# Windows (cmd)
.venv\Scripts\activate.bat
# Linux / macOS
source .venv/bin/activate
```

Then:

```bash
pip install -r requirements.txt
```

## Demo mode

Double-click **`index.html`**. No server, build step or real data is needed.
With an empty `data/manifest.js` (`const NISAR_MANIFEST = [];`), the site shows *"No processed NISAR files found. Showing DEMO data."* and uses four DEMO locations:

1. Bangladesh: Jamuna River erosion / flooding
2. Kosi River, Bihar (India): recurrent river floods
3. Lower Shire, Chikwawa–Nsanje (Malawi): cyclone and river floods
4. Beledweyne, Shabelle River (Somalia): river floods

All four are river communities where basic phones and SMS are the common link and warnings often arrive late.

## Real NISAR mode

1. Create a free **NASA Earthdata** account (https://urs.earthdata.nasa.gov).
2. Search for and download NISAR L2 products (**GCOV**, **GUNW** or **GOFF**) through ASF (https://search.asf.alaska.edu) or NASA Earthdata Search.
3. Put the `.h5` files into `data/raw/`.
4. Run:
   ```bash
   python process_nisar.py
   ```
5. Open `index.html`.

**Automatic REAL/DEMO switching:** the processor writes `data/manifest.js`. If a processed site's centre falls inside a demo location's bounding box, the real records **replace** that demo automatically. Other real sites appear as new locations. You never need to edit JavaScript. To return to demo mode, empty `data/raw/` and re-run the script.

Credentials never go in the project. You download the files yourself.

### What the processor does

- Finds the science layers: GCOV `HHHH`/`VVVV`/`HVHV`/`VHVH`; GUNW `unwrappedPhase`; GOFF `alongTrackOffset` + `slantRangeOffset`.
- Reads `xCoordinates`, `yCoordinates` and the `projection` EPSG code, then reprojects to EPSG:3857 (average resampling, ≤ 1024 px).
- Reads the metadata (`productType`, `zeroDopplerStartTime`, `granuleId`, and the maturity or processing descriptor if present) from `/science/<band>/identification`.
- GCOV: converts linear power to dB. For two or more same-polarization observations of one site, it computes the pixel-wise Δ dB, the % of pixels with |Δ| ≥ 3 dB, a histogram, and the open-water % at thresholds from −26 to −10 dB (default −18 dB, **exploratory**).
- GUNW: phase statistics in the file's units. It adds a relative line-of-sight displacement (d = −λφ/4π) only when the file gives the centre frequency.
- GOFF: offset magnitude in the file's units. This is **displacement, not velocity**.
- Checks that every PNG is < 1 MB (it re-encodes and shrinks if needed, and fails clearly otherwise).
- Unsupported or corrupt files are **skipped** with a "found / expected" report. Processing continues.

## Structure

```
index.html        landing page
explore.html      mission-control dashboard (map, timeline, before/after, metrics, charts, export)
bangladesh.html   concept prototype: NISAR-triggered warning (SIMULATED)
about.html        NISAR, radar, products, processing, limitations, credits
css/style.css     design system
js/app.js         normalised data model + all rendering
js/locations.js   DEMO locations and SIMULATED rules
data/manifest.js  generated by process_nisar.py
data/raw/         your NISAR .h5 files
data/processed/   generated PNG overlays
```

## Dashboard layout

- **Top bar → API:** status, latency and a quick endpoint tester for every connected live API.
- **Explore tabs:**
  - LIVE: catalog, timeline, revisit, time of day, dark-pixel proxy, granules.
  - FORECAST: predicted next NISAR passes (backtested), observed + forecast rain and temperature, proxy trend with 95% band, SIMULATED projected risk.
  - WEATHER: NASA POWER.
  - ANALYSIS: DEMO until real `.h5` files are processed; the overlay is off by default.
  - RECORDS: history and processing details.
- **Predictions** are statistical: next pass = last pass + median same-track interval, and the proxy trend is an OLS extrapolation. They are not physical flood forecasts.

## Fetching real NISAR data without downloading whole files

`fetch_nisar_subset.py` streams only a site-sized window out of a real NISAR GCOV granule, which is several GB each. It uses HTTP range requests and writes a small subset `.h5` into `data/raw/`. The subset keeps the original identification metadata and the NISAR validity mask.

```bash
# Earthdata token: EARTHDATA_TOKEN env var or ~/.earthdata_token (never inside the project)
python fetch_nisar_subset.py --bbox 89.45,24.25,89.95,24.85 --site jamuna <granule .h5 URL> [<URL> ...]
python process_nisar.py
```

Pick passes from the **same track** that **fully cover** the site; the granule footprints in NASA CMR show this. That way the change detection compares like with like.

## Site structure

Home (story) → **01 Observe** (`explore.html`: real NISAR map, before/after, 4 charts) → **02 Act** (`bangladesh.html`: radar trigger + NASA POWER rainfall → prototype rules → SMS) → Method (`about.html`).

## Jamuna Erosion Watch (`erosion_watch.py` → `erosion.html`)

Compares the two latest Jamuna scenes from the same NISAR track:
- 10 m → 20 m aggregation and a 5×5 speckle filter in linear power;
- water = backscatter below the histogram valley between the water and land modes (one threshold for both dates);
- river belt from the 500 m water fraction;
- west and east bank per image row, with shifts in metres (+ = outward). Jumps over 1 km are rejected as channel switches, and there is a 1 km running median;
- land lost and gained (km²);
- OpenStreetMap settlements ranked by distance to the latest bank. A settlement is flagged when it is ≤ 2 km from a bank that moved outward by more than twice the noise.

```bash
python erosion_watch.py      # writes data/erosion.js + data/processed/erosion_change.png
```

This is a screening signal. Two dates cannot separate erosion from water-level change, and there is no field validation yet.
"# echosphere" 
"# echosphere" 
"# echosphere" 
