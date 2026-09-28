# Verified data pipeline

Every number this project shows comes from one of the sources below, and
`scripts/audit_provenance.py` checks that claim against the live APIs rather
than trusting a filename or a status label.

## Sources

| Layer | Source | Freshness |
|---|---|---|
| National, state and per-MP totals | `mplads.mospi.gov.in` DigiGov pre-login API | live |
| MP roster and allocations | Official MoSPI "Allocated Limit for Hon'ble MPs" sheet | published sheet |
| Work-level records (46,348) | `github.com/vonter/india-mplads-works` (ODbL), scraped from the MoSPI portal | 17th Lok Sabha snapshot |
| Place coordinates | OpenStreetMap via Photon, Nominatim fallback | live lookup, static result |
| Satellite scene metadata | Sentinel-2 STAC on earth-search.aws.element84.com | live |
| Anomaly scores | Trained here on the real work records | re-runnable |

## What the open feed does not contain

MPLADS publishes no per-work GPS and no vendor GSTIN, so the pipeline leaves
those fields empty rather than filling them:

* `reported_lat`, `reported_lon` are **place centroids** of the village, block
  or constituency named in the record, not surveyed work sites. Several works in
  one village therefore share a point. `coordinate_precision` records the tier.
* `contractor_gstin` is always empty, so there is no contractor network, no
  GSTIN compliance score, and no bid-ringing detection.
* Roughly a third of records (15,915) carry the portal's own reference number
  such as `WS/MP521/2023-2024/3061`, which is stored in `work_id`. The
  remaining rows have no published identifier and `work_id` stays empty.
* No district codes, so lapse forecasting is not possible.

## Running it

```bash
# Refresh everything (MoSPI, works, geocode)
python data/sync_live_data.py

# Individual steps
python data/fetch_real_works.py      # 46,348 real work records
python data/sync_live_mospi.py       # live MoSPI aggregates
python data/geocode_works.py --stats # coverage only, no network
python data/geocode_works.py         # resolve place centroids
python ml/training/train_real.py     # retrain on real data

# Verify provenance
python scripts/audit_provenance.py
```

## Scheduled refresh

```bash
python data/install_scheduled_sync.py --time 03:15 --no-ingest
schtasks /Run /TN OjasMPLADSSentinelSync   # trigger now to verify
```

The task runs as the current user, so it only fires while that account is
logged in. Logs land in `data/raw/schedule/sync_scheduled.log`.

## Concurrency

`geocode_works.py` takes a single-writer lock at `data/raw/geocode.lock`. A
scheduled run that finds the lock held skips the geocode layer rather than
overwriting coordinates another process is still filling in. Remove the lock by
hand only if you are certain no geocoder is running.

## Retraining

`ml/training/train_real.py` trains the isolation forest on features derived only
from fields the real feed contains (`ml/features/real_features.py`). The model
manifest at `ml/saved_models/isolation_forest_manifest.json` records what it was
trained on, and the audit fails if a model is ever found without that manifest.

A high anomaly score means a work deviates from comparable works in its state
and category. It is a prompt for human review, not evidence of wrongdoing, and
the interface must not present it as a finding.
