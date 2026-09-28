# QUARANTINED - FABRICATED / SYNTHETIC DATA

Nothing in this directory was produced by a real source. It was moved here on
purpose so it cannot silently back a public-facing claim. Nothing was deleted;
move a file back to its original path to restore it.

Every item below was verified as generated, not merely assumed.

---

## Data files

| Original path | Why it is not real |
|---|---|
| `data/output/works.csv` | 3,000 rows. Every `work_id` is a generated sequential `MPLADS-YYYY-SS-NNNN`. Only 24 distinct contractor names across 3,000 works, 24 distinct GSTIN PAN prefixes, and 120 districts. Real MPLADS has ~46k works, ~780 districts, and hundreds of vendors. |
| `data/output/mgnrega_works.csv` | Built *from* `works.csv` by `fetch_mgnrega.py` using `np.random.seed(42)`, jittered coordinates, and `amount = sanction_amount * np.random.uniform(0.7, 1.3)`. Its own `source` column reads `MGNREGA_MIS_EXTRAPOLATED`. |
| `data/output/pmgsy_works.csv` | Built from `works.csv` with `np.random.seed(101)`. Road names are templated (`PMGSY Road to Cuttack Habit #1`), lengths are random. |
| `data/output/contractors.csv` | 99 of 300 CINs carry the sequential `PTC1000xx` pattern, 50 rows carry placeholder `DIN-010000xx`, and 63 phone numbers begin with digits India does not use. `gstin_status` values such as `ACTIVE_COMPLIANT` are not real GST statuses. |
| `data/output/cross_scheme_matches.csv` | Algorithmic output, but computed from the two synthetic files above, so the matches are fictional. It was being served live by `backend/routers/admin.py` and the frontend dashboard. |
| `data/reference/districts.csv` | Only 120 districts across 15 states (India has ~780 across 36). `district_code` uses a made-up `DIST-XX-NN` scheme rather than real LGD codes. `secc_deprivation_score` holds 41 invented values in 0.15-0.62 and was feeding the risk model. |
| `database/seed_demo_data.sql` | 2 MB of synthetic rows, the previous source of the app's populated screens. |

## Trained models

These were fit on the synthetic files above, so every score they emit is derived
from invented inputs. They are not "imperfect"; they are measuring nothing real.

| Original path | Trained on | Consequence |
|---|---|---|
| `ml/saved_models/isolation_forest.pkl` | `works.csv` | Drives the L1/L2/L3 risk tiers and every anomaly in the UI. |
| `ml/saved_models/prophet/prophet_models.pkl` | `works.csv` | Drives expenditure-progress forecasts. |
| `ml/saved_models/contractor_graph.pkl` | `contractors.csv` | Drives the contractor cartel network, which was rendering named vendors and invented ring edges. |

## Generators

Kept for reference so the synthetic pipeline is auditable. Do not run these to
"restore" the data; they are the source of the fabrication.

* `fetch_mgnrega.py`
* `fetch_pmgsy.py`
* `enrich_mca_contractors.py`

---

## Frontend assets and code

These are not data files, but they were moved here for the same reason: each one
made a claim the project cannot support, and each was either unverified or
unreferenced.

| Original path | Why it is here |
|---|---|
| `frontend/public/images/logo.jpg` | An unofficial rendering of the Government of India national emblem, 1024x1024 and re-hosted in the app. The header presented it as the project's own mark. Replaced by an inline neutral SVG in `frontend/components/StitchHeader.tsx`. |
| `frontend/public/images/satellite_before.jpg` | Generic stock aerial imagery, not a Sentinel-2 acquisition of any MPLADS site. Only referenced by a comment that described it as a before image. |
| `frontend/public/images/satellite_after.jpg` | Same as above, for the "after" slot. The pair implied a spectral comparison that the backend never performed. |
| `frontend/public/images/citizen_ground.jpg` | Unreferenced stock photograph. |
| `frontend/public/images/hospital.jpg` | Unreferenced stock photograph. |
| `frontend/lib/mockData.ts` | Hardcoded works, contractors and anomalies used as a frontend fallback. Invisible in the UI while a fallback, but a reader of the source would reasonably read it as real records. Removed: no mock fallback path exists in `frontend/lib/api.ts`. |
| `frontend/components/Navbar.tsx` | Superseded by `StitchHeader.tsx` and imported by nothing. Its own comments record the fixes made to the surviving header; the dead copy still carried a "MoSPI Risk-Intelligence Monitoring Layer" subtitle and an "AI-Gov v2.4" version badge. Renamed `Navbar_unused.tsx`. |
| `frontend/components/Sidebar.tsx` | Superseded and imported by nothing. It rendered a hardcoded "Multi-spectral NDBI diffing active. 1,482 works monitored across 543 constituencies" panel with an "88% Verified" progress bar and a "Prophet" model label — no NDBI diffing, Prophet forecast, or per-constituency monitor count exists anywhere in the project, and all four numbers were invented. Renamed `Sidebar_unused.tsx`. |

The four photographs carry no provenance, so they cannot be re-derived. Do not
move them back into `frontend/public/` and expect them to be usable.

---

## What replaced them

Real, verifiable sources now feed the project:

| Layer | Source |
|---|---|
| Work-level records (46,348 rows) | `data/fetch_real_works.py` -> github.com/vonter/india-mplads-works (ODbL, scraped from the MoSPI portal) |
| MP roster and live MP figures | `data/sync_live_mospi.py` -> mplads.mospi.gov.in DigiGov public API |
| National / state aggregates | same MoSPI API |
| Place coordinates | `data/geocode_works.py` -> OpenStreetMap via Photon / Nominatim |
| Satellite scene metadata | earth-search.aws.element84.com (Sentinel-2 STAC) |
| Provenance manifest | `data/output/sync_manifest.json` |

### Honest limitations that follow from the real feeds

MPLADS publishes no per-work identifier, no vendor GSTIN, and no surveyed GPS.
The app therefore reports:

* `work_id` as a **derived** surrogate (`MPLAD-<hash>`), clearly not an official reference number.
* coordinates as **place centroids** (village/block), not work-site GPS.
* contractor and GSTIN fields as **unavailable**, so the contractor network has
  no real vendor graph to show until a vendor-level source is obtained.

Anomalies and risk scores require retraining on the real dataset before they
mean anything. Until then the interface must present them as unavailable rather
than as findings.
