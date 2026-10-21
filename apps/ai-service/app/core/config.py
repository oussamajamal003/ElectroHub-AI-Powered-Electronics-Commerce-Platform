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

from dotenv import dotenv_values
from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

SERVICE_NAME = "electrohub-ai-service"
SERVICE_VERSION = "0.2.0"
API_VERSION = "v1"

SERVICE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENV_FILE = SERVICE_ROOT / ".env"

Environment = Literal["development", "qa", "production", "test"]

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
        "CLOUDINARY_URL",
        "DATABASE_URL",
        "DIRECT_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "PAYMENT_SHARED_MUTATIONS_APPROVED",
    }
)


class ConfigurationError(RuntimeError):
    """Raised when the runtime configuration is unsafe. Messages name settings, never values."""


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

    @field_validator("AI_SERVICE_API_KEY", mode="before")
    @classmethod
    def _blank_key_is_absent(cls, value: object) -> object:
        return None if isinstance(value, str) and value == "" else value

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
        if self.AI_ENVIRONMENT == "production":
            if self.AI_SERVICE_API_KEY is None:
                raise ValueError("AI_SERVICE_API_KEY is required in production")
            if self.AI_DOCS_ENABLED:
                raise ValueError("AI_DOCS_ENABLED cannot be enabled in production")
        if not self.binds_loopback and self.AI_SERVICE_API_KEY is None:
            raise ValueError("a non-loopback AI_BIND_HOST requires AI_SERVICE_API_KEY")
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


def forbidden_secrets_present(environ: Mapping[str, str | None]) -> list[str]:
    """Names of commerce secrets with a non-empty value in ``environ`` (never the values)."""
    return sorted(name for name in FORBIDDEN_COMMERCE_SECRETS if (environ.get(name) or "").strip())


def load_settings(
    environ: Mapping[str, str] | None = None,
    env_file: Path | None = DEFAULT_ENV_FILE,
) -> Settings:
    """Build settings for a real process, refusing commerce secrets in its environment."""
    source = os.environ if environ is None else environ
    file_values = dotenv_values(env_file) if env_file is not None and env_file.is_file() else {}
    present = forbidden_secrets_present({**file_values, **source})
    if present:
        raise ConfigurationError("The AI service must not receive commerce credentials: " + ", ".join(present))
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
