"""
MPLADS Sentinel — Application Configuration
"""

from pathlib import Path
from typing import List

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
except ImportError:
    # Pydantic v1 fallback. v1 has no SettingsConfigDict, so `model_config` is
    # not defined and the legacy `Config` inner class below is used instead.
    from pydantic import BaseSettings

    SettingsConfigDict = None

# Resolve the env file against this file's location, not the process CWD.
# The old value was the relative string "../.env", which only happened to find
# the repository .env when the app was started from inside backend/ — launching
# uvicorn from the repo root silently fell back to every default below,
# including the placeholder SECRET_KEY and the default database credentials.
REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / ".env"


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://mplads:mplads_pass@localhost:5432/mplads_sentinel"
    DATABASE_SYNC_URL: str = "postgresql://mplads:mplads_pass@localhost:5432/mplads_sentinel"

    # Redis / Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # Neo4j
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "mplads_neo4j_pass"

    # MinIO
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "mplads_minio"
    MINIO_SECRET_KEY: str = "mplads_minio_secret"
    MINIO_BUCKET_SATELLITE: str = "sentinel2-imagery"
    MINIO_BUCKET_CITIZEN: str = "citizen-photos"

    # Gemini API
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-1.5-pro"

    # Copernicus (Sentinel-2)
    COPERNICUS_USER: str = ""
    COPERNICUS_PASS: str = ""

    # Auth
    # No usable default. The placeholder below is detected at import time by
    # backend/auth.py, which refuses to sign or verify any token while it is
    # still in place — previously a shipped default secret silently signed every
    # token, so anyone who read the repo could mint an ADMIN token.
    SECRET_KEY: str = "change-this-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    # Where the optional local file store for citizen evidence uploads lives.
    UPLOAD_DIR: str = "data/uploads"
    MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024
    ALLOWED_UPLOAD_TYPES: List[str] = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
    ]

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
    ]

    # App
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    # ML
    ISOLATION_FOREST_CONTAMINATION: float = 0.05
    CONFIDENCE_L1_THRESHOLD: float = 30.0
    CONFIDENCE_L2_THRESHOLD: float = 55.0
    CONFIDENCE_L3_THRESHOLD: float = 75.0

    if SettingsConfigDict is not None:
        # Pydantic v2. The inner `class Config` form this replaced is
        # deprecated and warned on every import; `model_config` is the
        # replacement and carries the same four settings.
        model_config = SettingsConfigDict(
            env_file=str(ENV_FILE),
            env_file_encoding="utf-8",
            case_sensitive=True,
            extra="ignore",
        )
    else:

        class Config:
            env_file = str(ENV_FILE)
            env_file_encoding = "utf-8"
            case_sensitive = True
            extra = "ignore"


settings = Settings()
