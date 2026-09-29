"""
MPLADS Sentinel — FastAPI Backend
Main application entry point
"""

from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from auth import Principal, viewer
from config import settings
from database import create_tables
from routers import (
    admin,
    anomalies,
    auth as auth_router,
    citizen,
    contractors,
    mp,
    notifications,
    satellite,
    works,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    try:
        await create_tables()
    except Exception as e:
        # Routers use the configured database directly; there is no CSV/JSON
        # adapter. Claiming otherwise made a failed deployment look healthy.
        print(
            f"[Database] Startup check failed ({type(e).__name__}). "
            "Database-backed API routes will return errors until the configured "
            "database is reachable."
        )
    yield


app = FastAPI(
    title="MPLADS Sentinel API",
    description="AI-Powered Risk Intelligence for MPLADS Scheme Monitoring — SIH PS 26102",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────
app.include_router(auth_router.router,   prefix="/api/v1/auth",         tags=["Auth"])
app.include_router(works.router,       prefix="/api/v1/works",       tags=["Works"])
app.include_router(anomalies.router,   prefix="/api/v1/anomalies",   tags=["Anomalies"])
app.include_router(contractors.router, prefix="/api/v1/contractors", tags=["Contractors"])
app.include_router(satellite.router,   prefix="/api/v1/satellite",   tags=["Satellite"])
app.include_router(citizen.router,     prefix="/api/v1/citizen",     tags=["Citizen"])
app.include_router(mp.router,          prefix="/api/v1/mp",          tags=["MP"])
app.include_router(admin.router,       prefix="/api/v1/admin",       tags=["Admin"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["Notifications"])


@app.get("/health", tags=["Health"])
async def health():
    """Liveness probe. Deliberately unauthenticated and reveals nothing but that
    the process is up — no version, no configuration, no database detail."""
    return {"status": "ok"}


@app.get("/api/v1/auth/whoami", tags=["Auth"])
async def whoami(principal: Principal = Depends(viewer)):
    """State the caller's resolved role, or that they are anonymous.

    Useful for a client that needs to know whether to prompt for a login before
    it renders a privileged control, without guessing from local state.
    """
    return {
        "authenticated": principal.is_authenticated,
        "role": principal.role.value,
        "username": principal.username if principal.is_authenticated else None,
        "note": (
            "Anonymous callers may read published oversight data. Any action that "
            "writes requires a token from POST /api/v1/auth/login."
        ),
    }
