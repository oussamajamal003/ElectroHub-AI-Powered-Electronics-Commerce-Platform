"""Validated runtime configuration for the AI service.

Every value is read once at startup. Anything missing, malformed or unsafe stops the
process (or, for the internal credential outside production, keeps protected routes
closed) instead of silently falling back to a permissive default.
"""

from __future__ import annotations

import ipaddress
import os
import re
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, parse_qsl, urlsplit

from dotenv import dotenv_values
from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

SERVICE_NAME = "electrohub-ai-service"
SERVICE_VERSION = "0.2.0"
API_VERSION = "v1"

SERVICE_ROOT = Path(__file__).resolve().parents[2]
# AI_ENV_FILE points a process at another env file (an isolated QA instance passes a non-existent path so nothing
# from the developer's .env is inherited); unset keeps apps/ai-service/.env.
DEFAULT_ENV_FILE = Path(os.environ["AI_ENV_FILE"]) if os.environ.get("AI_ENV_FILE") else SERVICE_ROOT / ".env"

Environment = Literal["development", "qa", "production", "test"]
ProcessRole = Literal["api", "media_worker"]

MIN_API_KEY_LENGTH = 32
_PLACEHOLDER_KEY = re.compile(
    r"(your-|change[-_ ]?me|placeholder|replace[-_ ]?(me|with)|example|password|secret-key|dummy)",
    re.IGNORECASE,
)

# Commerce/financial credentials the AI process must never hold (U06). A restricted
# vector-store credential introduced in 04.2 gets its own AI_-prefixed name.
FORBIDDEN_COMMERCE_SECRETS = frozenset(
    {
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "BREVO_API_KEY",
        "JWT_SECRET",
        "JWT_REFRESH_SECRET",
        "OTP_HASH_SECRET",
        "GOOGLE_CLIENT_SECRET",
        "DATABASE_URL",
        "DIRECT_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_DB_PASSWORD",
        "E2E_TEST_SUPPORT_TOKEN",
        "AI_VECTOR_INGEST_DATABASE_URL",
        "AI_VECTOR_ADMIN_DATABASE_URL",
        "CLOUDINARY_URL",
        "PAYMENT_SHARED_MUTATIONS_APPROVED",
    }
)

FORBIDDEN_MEDIA_WORKER_SECRETS = frozenset(
    {
        "AI_VECTOR_DATABASE_URL",
        "AI_SERVICE_API_KEY",
    }
)

MEDIA_PROJECT_REFS = {
    "development": "pzxekjybdiulzmssalfo",
    "production": "yepfgjehdstlxbpespun",
}
_POOLER_HOST = re.compile(r"^aws-\d+-[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$")
_QA_MEDIA_DATABASE = re.compile(r"^electrohub_disposable_media_[a-z0-9]+$")
_QA_MEDIA_ROLE = re.compile(r"^media_qa_worker_[a-f0-9]{12}$")


class ConfigurationError(RuntimeError):
    """Raised when the runtime configuration is unsafe. Messages name settings, never values."""


_TLS_MODES = frozenset({"require", "verify-ca", "verify-full"})


def check_vector_database_url(url: str) -> None:
    """Refuse malformed or plaintext vector-store URLs. Messages never include the URL."""
    try:
        parts = urlsplit(url)
        _ = parts.port  # raises ValueError on a malformed port
    except ValueError as exc:
        raise ValueError("AI_VECTOR_DATABASE_URL must be a valid postgresql:// URL") from exc
    if parts.scheme not in ("postgresql", "postgres"):
        raise ValueError("AI_VECTOR_DATABASE_URL must use the postgresql:// scheme")
    host = parts.hostname
    if not host or not parts.path.strip("/"):
        raise ValueError("AI_VECTOR_DATABASE_URL must name a host and a database")
    loopback = host == "localhost" or _is_loopback_ip(host)
    sslmode = parse_qs(parts.query).get("sslmode", [""])[-1]
    if loopback:
        return
    if sslmode not in _TLS_MODES:
        raise ValueError("AI_VECTOR_DATABASE_URL must set sslmode=require, verify-ca or verify-full for a remote host")


def _media_worker_database_identity(url: str) -> tuple[str | None, bool]:
    """Return the exact Supabase project ref, or a local-disposable marker, from a worker DSN.

    Direct database hosts bind the project ref in the hostname. Shared Supavisor hosts are
    cluster-wide, so the exact ref must be bound by the documented ``role.project-ref`` user.
    Ambiguous host/user combinations are rejected instead of inferred from substrings.
    """
    try:
        parts = urlsplit(url)
        port = parts.port
        query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    except ValueError as exc:
        raise ValueError("AI_MEDIA_WORKER_DATABASE_URL must be a valid PostgreSQL URL") from exc
    host = (parts.hostname or "").lower()
    user = parts.username or ""
    database = parts.path.lstrip("/")
    query_keys = [name for name, _ in query_pairs]
    ssl_modes = [value for name, value in query_pairs if name == "sslmode"]
    if (
        parts.scheme not in {"postgres", "postgresql"}
        or not host
        or not user
        or parts.password is None
        or not database
        or parts.fragment
        or len(query_keys) != len(set(query_keys))
        or any(name in {"host", "hostaddr", "port", "dbname", "user", "service"} for name in query_keys)
    ):
        raise ValueError("AI_MEDIA_WORKER_DATABASE_URL must identify a PostgreSQL host, role and database")
    if len(ssl_modes) != 1 or ssl_modes[0] not in _TLS_MODES:
        raise ValueError("AI_MEDIA_WORKER_DATABASE_URL must require TLS")

    loopback = host in {"localhost", "127.0.0.1", "::1"}
    if loopback:
        if port != 55434 or not _QA_MEDIA_DATABASE.fullmatch(database) or not _QA_MEDIA_ROLE.fullmatch(user):
            raise ValueError(
                "AI_MEDIA_WORKER_DATABASE_URL must use the approved disposable QA database and worker role"
            )
        return None, True

    direct_match = re.fullmatch(r"db\.(pzxekjybdiulzmssalfo|yepfgjehdstlxbpespun)\.supabase\.co", host)
    if direct_match:
        project_ref = direct_match.group(1)
        if port != 5432 or user != "ai_media_worker_runtime" or database != "postgres":
            raise ValueError(
                "AI_MEDIA_WORKER_DATABASE_URL must use the restricted media-worker role on the Supabase database"
            )
        return project_ref, False

    if _POOLER_HOST.fullmatch(host):
        pooler_user = re.fullmatch(r"ai_media_worker_runtime\.(pzxekjybdiulzmssalfo|yepfgjehdstlxbpespun)", user)
        if pooler_user is None or port not in {5432, 6543} or database != "postgres":
            raise ValueError(
                "AI_MEDIA_WORKER_DATABASE_URL must use the restricted role and project-bound Supabase pooler identity"
            )
        return pooler_user.group(1), False

    raise ValueError("AI_MEDIA_WORKER_DATABASE_URL host is not an approved Supabase project or disposable QA target")


def _validate_media_worker_target(environment: Environment, database_url: str, storage_url: str | None) -> None:
    project_ref, is_disposable = _media_worker_database_identity(database_url)
    if environment in MEDIA_PROJECT_REFS:
        expected_ref = MEDIA_PROJECT_REFS[environment]
        if is_disposable or project_ref != expected_ref:
            raise ValueError(f"AI media worker database must belong to the {environment} Supabase project")
        if storage_url is None:
            raise ValueError("AI_MEDIA_STORAGE_BASE_URL is required for hosted media-worker processing")
        storage_host = (urlsplit(storage_url).hostname or "").lower()
        if storage_host != f"{expected_ref}.supabase.co" or urlsplit(storage_url).scheme != "https":
            raise ValueError(f"AI_MEDIA_STORAGE_BASE_URL must belong to the {environment} Supabase project")
        return

    # QA/test workers are permitted only against the launcher-owned disposable PostgreSQL
    # instance and a loopback media fixture. They cannot use either shared hosted project.
    if environment in {"qa", "test"}:
        if not is_disposable or storage_url is None:
            raise ValueError("QA media workers require the approved disposable database and local media source")
        source = urlsplit(storage_url)
        if source.scheme != "http" or source.hostname not in {"localhost", "127.0.0.1", "::1"} or source.port is None:
            raise ValueError("QA media workers require a loopback HTTP media source with an explicit port")
        return
    raise ValueError("AI media worker environment is not authorized")


def _is_loopback_ip(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=DEFAULT_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
        frozen=True,
        # Validation errors must never echo a credential back into logs or tracebacks.
        hide_input_in_errors=True,
    )

    PROJECT_NAME: str = "ElectroHub AI Service"
    # ENVIRONMENT is the pre-04.1 name; AI_ENVIRONMENT wins when both are present.
    AI_ENVIRONMENT: Environment = Field(validation_alias=AliasChoices("AI_ENVIRONMENT", "ENVIRONMENT"))
    AI_PROCESS_ROLE: ProcessRole = "api"
    AI_SERVICE_API_KEY: SecretStr | None = None

    AI_BIND_HOST: str = "127.0.0.1"
    AI_PORT: int = Field(default=8000, ge=1024, le=65535)
    AI_DOCS_ENABLED: bool | None = None
    AI_LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    AI_MAX_REQUEST_BYTES: int = Field(default=1_048_576, ge=1024, le=20 * 1_048_576)
    AI_MAX_TOP_K: int = Field(default=24, ge=1, le=100)
    AI_MAX_CANDIDATES: int = Field(default=200, ge=1, le=1000)
    AI_INFERENCE_TIMEOUT_SECONDS: float = Field(default=5.0, ge=0.1, le=60.0)
    AI_MAX_CONCURRENT_INFERENCES: int = Field(default=2, ge=1, le=16)

    # Image search (Task 04.2). The multipart route allows AI_MAX_IMAGE_BYTES plus a fixed overhead; every
    # other route keeps AI_MAX_REQUEST_BYTES.
    AI_MAX_IMAGE_BYTES: int = Field(default=8_388_608, ge=65_536, le=16 * 1_048_576)
    AI_MAX_IMAGE_PIXELS: int = Field(default=40_000_000, ge=1_000_000, le=89_000_000)
    AI_TORCH_THREADS: int = Field(default=2, ge=1, le=16)
    # Directory holding model.safetensors and descriptor.json, mounted read-only. Unset = no encoder (503).
    AI_MODEL_ARTIFACT_DIR: Path | None = None
    # Directory holding relevance.json and head.safetensors (calibrated no-match gate). Unset = every search returns
    # the nearest topK products, as before Task 04.2-Q.
    AI_RELEVANCE_ARTIFACT_DIR: Path | None = None
    # Least-privilege, read-only connection to the ai schema (ai_vector_reader). Unset = no index (503).
    AI_VECTOR_DATABASE_URL: SecretStr | None = None
    # Separate, narrowly privileged catalog-media sync worker. Never used by the online API process.
    AI_MEDIA_WORKER_DATABASE_URL: SecretStr | None = None
    # Public Supabase project URL used only to construct immutable canonical object URLs from trusted DB keys.
    AI_MEDIA_STORAGE_BASE_URL: str | None = None

    @field_validator("AI_SERVICE_API_KEY", mode="before")
    @classmethod
    def _blank_key_is_absent(cls, value: object) -> object:
        return None if isinstance(value, str) and value == "" else value

    @field_validator(
        "AI_MODEL_ARTIFACT_DIR",
        "AI_RELEVANCE_ARTIFACT_DIR",
        "AI_VECTOR_DATABASE_URL",
        "AI_MEDIA_WORKER_DATABASE_URL",
        "AI_MEDIA_STORAGE_BASE_URL",
        mode="before",
    )
    @classmethod
    def _blank_optional_is_absent(cls, value: object) -> object:
        return None if isinstance(value, str) and value.strip() == "" else value

    @field_validator("AI_VECTOR_DATABASE_URL")
    @classmethod
    def _vector_dsn_is_safe(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None:
            check_vector_database_url(value.get_secret_value())
        return value

    @field_validator("AI_MEDIA_WORKER_DATABASE_URL")
    @classmethod
    def _media_worker_database_url_is_safe(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None:
            check_vector_database_url(value.get_secret_value())
        return value

    @field_validator("AI_MEDIA_STORAGE_BASE_URL")
    @classmethod
    def _media_storage_base_url_is_safe(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            parts = urlsplit(value)
            port = parts.port
        except ValueError as exc:
            raise ValueError("AI_MEDIA_STORAGE_BASE_URL must be a valid origin") from exc
        host = (parts.hostname or "").lower()
        if (
            not host
            or parts.username is not None
            or parts.password is not None
            or parts.query
            or parts.fragment
            or parts.path not in {"", "/"}
        ):
            raise ValueError("AI_MEDIA_STORAGE_BASE_URL must be a public HTTPS origin or local HTTP origin")
        if parts.scheme == "https" and host not in {f"{ref}.supabase.co" for ref in MEDIA_PROJECT_REFS.values()}:
            raise ValueError("AI_MEDIA_STORAGE_BASE_URL must match an approved Supabase project origin")
        if parts.scheme == "https" and port not in {None, 443}:
            raise ValueError("AI_MEDIA_STORAGE_BASE_URL must use the standard HTTPS port")
        if parts.scheme == "http" and (host not in {"localhost", "127.0.0.1", "::1"} or port is None):
            raise ValueError("AI_MEDIA_STORAGE_BASE_URL must use loopback HTTP with an explicit port")
        if parts.scheme not in {"https", "http"}:
            raise ValueError("AI_MEDIA_STORAGE_BASE_URL must use HTTPS or loopback HTTP")
        return value.rstrip("/")

    @field_validator("AI_SERVICE_API_KEY")
    @classmethod
    def _strong_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        raw = value.get_secret_value()
        if (
            len(raw) < MIN_API_KEY_LENGTH
            or raw != raw.strip()
            or not raw.isascii()
            or not raw.isprintable()
            or len(set(raw)) < 8
            or _PLACEHOLDER_KEY.search(raw)
        ):
            raise ValueError(
                f"AI_SERVICE_API_KEY must be a unique, non-placeholder value of at least "
                f"{MIN_API_KEY_LENGTH} printable ASCII characters"
            )
        return value

    @field_validator("AI_BIND_HOST")
    @classmethod
    def _bind_host_is_ip(cls, value: str) -> str:
        try:
            ipaddress.ip_address(value)
        except ValueError as exc:
            raise ValueError("AI_BIND_HOST must be a literal IP address") from exc
        return value

    @model_validator(mode="after")
    def _environment_rules(self) -> Settings:
        if self.AI_ENVIRONMENT == "production" and self.AI_PROCESS_ROLE == "api":
            if self.AI_SERVICE_API_KEY is None:
                raise ValueError("AI_SERVICE_API_KEY is required in production")
            if self.AI_DOCS_ENABLED:
                raise ValueError("AI_DOCS_ENABLED cannot be enabled in production")
        if self.AI_PROCESS_ROLE == "api" and not self.binds_loopback and self.AI_SERVICE_API_KEY is None:
            raise ValueError("a non-loopback AI_BIND_HOST requires AI_SERVICE_API_KEY")
        if self.AI_PROCESS_ROLE == "api" and (
            self.AI_MEDIA_WORKER_DATABASE_URL is not None or self.AI_MEDIA_STORAGE_BASE_URL is not None
        ):
            raise ValueError("AI media-worker settings are allowed only in the media-worker process")
        if self.AI_PROCESS_ROLE == "media_worker":
            if (
                self.AI_MEDIA_WORKER_DATABASE_URL is None
                or self.AI_MODEL_ARTIFACT_DIR is None
                or self.AI_MEDIA_STORAGE_BASE_URL is None
            ):
                raise ValueError(
                    "media-worker role requires AI_MEDIA_WORKER_DATABASE_URL, AI_MODEL_ARTIFACT_DIR and "
                    "AI_MEDIA_STORAGE_BASE_URL"
                )
            if self.AI_SERVICE_API_KEY is not None or self.AI_VECTOR_DATABASE_URL is not None:
                raise ValueError("media-worker role must not receive API or read-only search credentials")
            _validate_media_worker_target(
                self.AI_ENVIRONMENT,
                self.AI_MEDIA_WORKER_DATABASE_URL.get_secret_value(),
                self.AI_MEDIA_STORAGE_BASE_URL,
            )
        return self

    @property
    def binds_loopback(self) -> bool:
        return ipaddress.ip_address(self.AI_BIND_HOST).is_loopback

    @property
    def docs_enabled(self) -> bool:
        if self.AI_DOCS_ENABLED is not None:
            return self.AI_DOCS_ENABLED
        return self.AI_ENVIRONMENT in ("development", "test")

    @property
    def auth_configured(self) -> bool:
        return self.AI_SERVICE_API_KEY is not None


class _ExplicitSettings(Settings):
    """Settings that read only the values passed in: no process environment, no .env file."""

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (init_settings,)


def settings_from_mapping(values: Mapping[str, object]) -> Settings:
    # Keys are arbitrary environment names; pydantic validates them at runtime.
    return _ExplicitSettings(**dict(values))  # type: ignore[arg-type]


def forbidden_secrets_present(environ: Mapping[str, str | None], *, process_role: str = "api") -> list[str]:
    """Names of commerce/training-only settings with a non-empty value (never the values)."""
    forbidden = FORBIDDEN_COMMERCE_SECRETS
    if process_role == "media_worker":
        forbidden = forbidden | FORBIDDEN_MEDIA_WORKER_SECRETS
    return sorted(
        name
        for name, value in environ.items()
        if (name in forbidden or name.startswith("KAGGLE_")) and (value or "").strip()
    )


def load_settings(
    environ: Mapping[str, str] | None = None,
    env_file: Path | None = DEFAULT_ENV_FILE,
) -> Settings:
    """Build settings for a real process, refusing commerce secrets in its environment."""
    source = os.environ if environ is None else environ
    file_values = dotenv_values(env_file) if env_file is not None and env_file.is_file() else {}
    merged = {**file_values, **source}
    process_role = str(merged.get("AI_PROCESS_ROLE", "api"))
    present = sorted(
        set(forbidden_secrets_present(file_values, process_role=process_role))
        | set(forbidden_secrets_present(source, process_role=process_role))
    )
    if present:
        raise ConfigurationError(
            "The AI service must not receive commerce credentials or training settings: " + ", ".join(present)
        )
    try:
        if environ is None:
            return Settings(_env_file=env_file)
        return settings_from_mapping({k: v for k, v in {**file_values, **source}.items() if v is not None})
    except ValueError as exc:
        # pydantic ValidationError is a ValueError; report setting names and reasons only.
        raise ConfigurationError(_describe(exc)) from None


def _describe(exc: ValueError) -> str:
    errors = getattr(exc, "errors", None)
    if not callable(errors):
        return "Invalid AI service configuration"
    parts = []
    for error in errors(include_input=False, include_url=False):
        location = ".".join(str(part) for part in error.get("loc", ())) or "settings"
        parts.append(f"{location}: {error.get('msg', 'invalid')}")
    return "Invalid AI service configuration (" + "; ".join(parts) + ")"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
