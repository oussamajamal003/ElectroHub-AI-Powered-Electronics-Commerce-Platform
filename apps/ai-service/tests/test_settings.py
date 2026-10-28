from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import ConfigurationError, load_settings, settings_from_mapping
from tests.conftest import TEST_KEY, make_settings


def test_environment_is_required() -> None:
    with pytest.raises(ValidationError):
        settings_from_mapping({"AI_SERVICE_API_KEY": TEST_KEY})


def test_legacy_environment_name_is_accepted_and_new_name_wins() -> None:
    assert settings_from_mapping({"ENVIRONMENT": "development"}).AI_ENVIRONMENT == "development"
    both = settings_from_mapping({"ENVIRONMENT": "development", "AI_ENVIRONMENT": "qa", "AI_SERVICE_API_KEY": TEST_KEY})
    assert both.AI_ENVIRONMENT == "qa"


@pytest.mark.parametrize("environment", ["staging", "prod", "", "DEVELOPMENT"])
def test_unknown_environment_is_rejected(environment: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(AI_ENVIRONMENT=environment)


@pytest.mark.parametrize(
    "key",
    [
        "short-key",
        "a" * 40,  # too few distinct characters
        f" {TEST_KEY}",  # surrounding whitespace
        "your-ai-service-key-goes-here-0123456789",
        "change-me-0123456789abcdefghijklmnopqrstuv",
        "placeholder0123456789abcdefghijklmnopqrstu",
        "ünïcode-0123456789abcdefghijklmnopqrstuvw",
    ],
)
def test_weak_or_placeholder_keys_are_rejected(key: str) -> None:
    with pytest.raises(ValidationError) as exc:
        make_settings(AI_SERVICE_API_KEY=key)
    assert key not in str(exc.value)


def test_blank_key_means_not_configured_outside_production() -> None:
    settings = make_settings(AI_ENVIRONMENT="development", AI_SERVICE_API_KEY="")
    assert settings.auth_configured is False


def test_production_requires_a_key() -> None:
    with pytest.raises(ValidationError, match="required in production"):
        make_settings(AI_ENVIRONMENT="production", AI_SERVICE_API_KEY="")


def test_production_forbids_docs_and_disables_them_by_default() -> None:
    with pytest.raises(ValidationError, match="AI_DOCS_ENABLED"):
        make_settings(AI_ENVIRONMENT="production", AI_DOCS_ENABLED=True)
    assert make_settings(AI_ENVIRONMENT="production").docs_enabled is False
    assert make_settings(AI_ENVIRONMENT="qa").docs_enabled is False
    assert make_settings(AI_ENVIRONMENT="development").docs_enabled is True


def test_network_bind_without_key_is_refused() -> None:
    with pytest.raises(ValidationError, match="non-loopback"):
        make_settings(AI_ENVIRONMENT="development", AI_SERVICE_API_KEY="", AI_BIND_HOST="0.0.0.0")  # noqa: S104
    assert make_settings(AI_BIND_HOST="0.0.0.0").binds_loopback is False  # noqa: S104
    assert make_settings(AI_BIND_HOST="::1").binds_loopback is True


@pytest.mark.parametrize("host", ["localhost", "ai.example.com", "127.0.0.1:8000"])
def test_bind_host_must_be_an_ip_literal(host: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(AI_BIND_HOST=host)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("AI_MAX_REQUEST_BYTES", 10),
        ("AI_MAX_REQUEST_BYTES", 50 * 1024 * 1024),
        ("AI_MAX_TOP_K", 0),
        ("AI_MAX_TOP_K", 101),
        ("AI_MAX_CANDIDATES", 5000),
        ("AI_INFERENCE_TIMEOUT_SECONDS", 0),
        ("AI_INFERENCE_TIMEOUT_SECONDS", 3600),
        ("AI_MAX_CONCURRENT_INFERENCES", 0),
        ("AI_PORT", 80),
    ],
)
def test_out_of_range_budgets_are_rejected(name: str, value: int) -> None:
    with pytest.raises(ValidationError):
        make_settings(**{name: value})


def test_load_settings_refuses_commerce_secrets_from_process_environment() -> None:
    environ = {
        "AI_ENVIRONMENT": "development",
        "STRIPE_SECRET_KEY": "sk_test_value",
        "DATABASE_URL": "postgres://u:p@h/db",
    }
    with pytest.raises(ConfigurationError) as exc:
        load_settings(environ, env_file=None)
    message = str(exc.value)
    assert "DATABASE_URL" in message and "STRIPE_SECRET_KEY" in message
    assert "sk_test_value" not in message and "postgres://" not in message


def test_load_settings_refuses_commerce_secrets_from_env_file(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text('AI_ENVIRONMENT="development"\nBREVO_API_KEY="xkeysib-value"\n', encoding="utf-8")
    with pytest.raises(ConfigurationError, match="BREVO_API_KEY"):
        load_settings({}, env_file=env_file)


def test_load_settings_ignores_empty_commerce_variables() -> None:
    settings = load_settings(
        {"AI_ENVIRONMENT": "qa", "AI_SERVICE_API_KEY": TEST_KEY, "STRIPE_SECRET_KEY": ""}, env_file=None
    )
    assert settings.AI_ENVIRONMENT == "qa"


def test_media_worker_credential_is_refused_by_api_role() -> None:
    with pytest.raises(ConfigurationError, match="media-worker settings"):
        load_settings(
            {
                "AI_ENVIRONMENT": "test",
                "AI_SERVICE_API_KEY": TEST_KEY,
                "AI_MEDIA_WORKER_DATABASE_URL": "postgresql://u:p@localhost:5432/electrohub",
            },
            env_file=None,
        )


def test_media_worker_role_requires_its_own_database_and_artifact() -> None:
    with pytest.raises(ConfigurationError, match="media-worker role requires"):
        load_settings({"AI_ENVIRONMENT": "test", "AI_PROCESS_ROLE": "media_worker"}, env_file=None)


def test_media_storage_origin_rejects_unapproved_hosts_and_paths() -> None:
    with pytest.raises(ValidationError, match="approved Supabase project origin"):
        settings_from_mapping(
            {
                "AI_ENVIRONMENT": "test",
                "AI_PROCESS_ROLE": "media_worker",
                "AI_MEDIA_WORKER_DATABASE_URL": "postgresql://u:p@localhost:5432/electrohub",
                "AI_MODEL_ARTIFACT_DIR": "C:/models",
                "AI_MEDIA_STORAGE_BASE_URL": "https://attacker.example",
            }
        )


def test_load_settings_reports_names_not_values() -> None:
    with pytest.raises(ConfigurationError) as exc:
        load_settings({"AI_ENVIRONMENT": "production", "AI_SERVICE_API_KEY": "tooshort-secret-value"}, env_file=None)
    assert "AI_SERVICE_API_KEY" in str(exc.value)
    assert "tooshort-secret-value" not in str(exc.value)


def test_settings_repr_never_prints_the_key() -> None:
    assert TEST_KEY not in repr(make_settings())


@pytest.mark.parametrize("name", ["KAGGLE_API_TOKEN", "KAGGLE_USERNAME", "KAGGLE_KEY", "KAGGLE_CONFIG_DIR"])
def test_serving_refuses_all_training_only_kaggle_settings(name: str, tmp_path: Path) -> None:
    value = "private-training-value"
    with pytest.raises(ConfigurationError) as process_error:
        load_settings({"AI_ENVIRONMENT": "qa", name: value}, env_file=None)
    assert name in str(process_error.value) and value not in str(process_error.value)
    env_file = tmp_path / ".env"
    env_file.write_text(f"AI_ENVIRONMENT=qa\n{name}={value}\n", encoding="utf-8")
    with pytest.raises(ConfigurationError) as file_error:
        load_settings({}, env_file=env_file)
    assert name in str(file_error.value) and value not in str(file_error.value)
