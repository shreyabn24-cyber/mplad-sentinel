# Backend tests

Four suites, none of which need a live PostgreSQL:

| File | Covers |
| --- | --- |
| `test_auth.py` | Password hashing, token issue/decode, role gates, and the access decision on every endpoint. The database dependency is stubbed so the real token → DB → role chain runs. |
| `test_uploads.py` | Evidence file validation, size/count limits, magic-byte content typing, and path containment on both write and read-back. |
| `test_migrations.py` | Migration discovery and ordering, driver-suffix handling, that no migration seeds an account, and that every statement is safe to re-run. |
| `test_demand_queue.py` | Office request queue scoping and the review action: state-aware scope, fail-closed on missing jurisdiction, role-restricted routing, the withdrawn conflict, and that a review is attributable and never carries an order-number-shaped identifier. |

```
python -m pytest backend/tests -q
```

## What these tests are for

The access-control tests assert *negative* facts, which is the point: a route
that stops enforcing its dependency fails the suite. `test_auth.py` walks the
live route table so a newly added endpoint is covered the moment it appears.

Four of them cover bugs that were live in this codebase:

- `may_act_in_state` granted `PUBLIC` national scope, so an anonymous principal
  satisfied a state check it should never pass.
- The notification bus inserted `"ALL"` into every recipient set, which made the
  role filter unreachable and pushed every event to every connected screen.
- `_scope_demands` matched an MP or district account on the jurisdiction *name*
  alone. Constituency and district names are not unique across India, so an
  account provisioned with one name in one state also matched every request
  carrying that name in every other state. The scope is now name **and** state.
- `DemandDecision.routed_to_role` accepted the whole `Role` enum, so a request
  could be parked in `PUBLIC` or `CITIZEN` — neither of which is a queue, so the
  request would become invisible to any reviewer. Only office roles are accepted
  now.

The scope tests were checked by mutation: removing the `state_code` clause from
the MP branch of `_scope_demands` makes
`test_mp_scope_includes_state_code` and
`test_mp_queue_query_constrains_state` fail, so they are not passing
vacuously. The session stub in that file applies the query's bound parameters to
its in-memory rows for the same reason — a stub that ignored the `WHERE` clause
would return a row for a cross-state access attempt and the test would be
decoration.

## A note on `SECRET_KEY`

The signing guard refuses any key that still contains template text. The
repository ships such a value in `.env`, so `test_auth.py` installs a generated
one at import time. That is deliberate and test-only: it means the suite
exercises the real guard rather than bypassing it. If you see

```
SECRET_KEY still contains template text, so it is not a secret.
```

when starting the API locally, that is the guard working. Set a real key:

```
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## What is not covered

No test needs a database, and therefore none of them proves the SQL is valid
PostgreSQL. `run_migrations.py --status` and an ingestion run are still the
first checks to do once a server is available. The response bodies of data
routes are also untested: they need rows to return.
