# Generated work data

`works_real.csv` is a local, normalized derivative of the cached public MPLADS
feed (`data/raw/mplads_works_*.csv`). It is real source data, **not synthetic
demo data**. The raw feed's absent coordinates, contractor details, and other
fields remain blank. The importer preserves an upstream work reference when
present and derives a clearly prefixed surrogate only when the feed has none.

The current generated file merges five verified rows from the cached
`works_real_geocoded_sample.csv`. Those points are marked `CENTROID`; they are
place centroids, not surveyed work GPS. All other rows remain unlocated. Run
`python data/apply_geocoded_coordinates.py` after regenerating the CSV to apply
the same identity-checked merge.

Regenerate it offline from a cached feed with the `build_records` and
`write_csv` functions in `data/fetch_real_works.py`, or fetch a current source
copy with `python data/fetch_real_works.py`. The output CSV is git-ignored to
avoid committing a large data snapshot. The database importer reads it from
this directory.

The only synthetic identities are the five `demo_*` accounts created by
`backend/seed_demo_users.py`. They require `DEMO_MODE=true`,
`ENVIRONMENT=development`, and a private `DEMO_PASSWORD`; they are never seeded
by production migrations. Set `NEXT_PUBLIC_DEMO_MODE=true` in the frontend's
local environment to show those role shortcuts on `/login`. Set the same
`DEMO_PASSWORD` in the backend environment before seeding.
