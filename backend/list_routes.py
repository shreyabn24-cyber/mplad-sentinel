"""Print the API surface, with the auth dependency each route resolves to.

Run from `backend/`:  python list_routes.py
"""

import inspect
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from fastapi.routing import APIRoute  # noqa: E402

import main as app_module  # noqa: E402  (aliased: `main` would shadow the local entry point)


def describe(route: APIRoute) -> str:
    """Summarise the access control a route actually has."""
    guards = []
    for dep in route.dependant.dependencies:
        call = getattr(dep, "call", None)
        name = getattr(call, "__name__", "")
        if name.startswith("require_"):
            guards.append(name)
        elif name == "viewer":
            guards.append("viewer(public-read)")
        elif name == "current_principal":
            guards.append("principal")
    if not guards:
        return "NONE"
    return ",".join(sorted(set(guards)))


def run() -> int:
    rows = []
    for route in app_module.app.routes:
        if not isinstance(route, APIRoute):
            continue
        methods = ",".join(sorted((route.methods or set()) - {"HEAD", "OPTIONS"}))
        rows.append((route.path, methods, describe(route)))

    open_rows = [r for r in rows if r[2] == "NONE"]
    print(f"total APIRoute endpoints: {len(rows)}")
    print()
    width = max(len(p) for p, _, _ in rows) + 2
    for path, methods, guard in sorted(rows):
        flag = "  " if guard != "NONE" else "!!"
        print(f"{flag}{methods:<22} {path:<{width}} {guard}")
    print()
    print(f"endpoints with NO auth dependency at all: {len(open_rows)}")
    for path, methods, _ in open_rows:
        print(f"   {methods:<20} {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
