from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import ConfigurationError, load_settings, settings_from_mapping
from tests.conftest import TEST_KEY, make_settings

DEV_REF = "pzxekjybdiulzmssalfo"
PROD_REF = "yepfgjehdstlxbpespun"
DEV_DATABASE_URL = (
    f"postgresql://ai_media_worker_runtime:db-secret@db.{DEV_REF}.supabase.co:5432/postgres?sslmode=require"
)
PROD_DATABASE_URL = (
    f"postgresql://ai_media_worker_runtime:db-secret@db.{PROD_REF}.supabase.co:5432/postgres?sslmode=require"
)
DEV_STORAGE_URL = f"https://{DEV_REF}.supabase.co"
PROD_STORAGE_URL = f"https://{PROD_REF}.supabase.co"
QA_DATABASE_URL = (
    "postgresql://media_qa_worker_ab12cd34ef56:db-secret@127.0.0.1:55434/"
    "electrohub_disposable_media_0123456789?sslmode=verify-full"
)
QA_STORAGE_URL = "http://127.0.0.1:35217"


def media_worker_values(
    *, environment: str = "development", database_url: str = DEV_DATABASE_URL, storage_url: str = DEV_STORAGE_URL
) -> dict[str, str]:
    return {
        "AI_ENVIRONMENT": environment,
        "AI_PROCESS_ROLE": "media_worker",
        "AI_MEDIA_WORKER_DATABASE_URL": database_url,
        "AI_MODEL_ARTIFACT_DIR": "C:/models/siglip",
        "AI_MEDIA_STORAGE_BASE_URL": storage_url,
    }


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


def test_dev_worker_accepts_only_exact_dev_database_and_storage_identity() -> None:
    settings = load_settings(media_worker_values(), env_file=None)
    assert settings.AI_ENVIRONMENT == "development"

    pooler_url = (
        f"postgresql://ai_media_worker_runtime.{DEV_REF}:db-secret@aws-1-us-east-2.pooler.supabase.com:6543/"
        "postgres?sslmode=verify-full"
    )
    assert load_settings(media_worker_values(database_url=pooler_url), env_file=None).AI_PROCESS_ROLE == "media_worker"


@pytest.mark.parametrize(
    ("environment", "database_url", "storage_url"),
    [
        ("development", PROD_DATABASE_URL, DEV_STORAGE_URL),
        ("development", DEV_DATABASE_URL, PROD_STORAGE_URL),
        ("production", DEV_DATABASE_URL, PROD_STORAGE_URL),
        ("production", PROD_DATABASE_URL, DEV_STORAGE_URL),
    ],
)
def test_hosted_worker_rejects_cross_environment_database_or_storage(
    environment: str, database_url: str, storage_url: str
) -> None:
    with pytest.raises(ConfigurationError):
        load_settings(
            media_worker_values(environment=environment, database_url=database_url, storage_url=storage_url),
            env_file=None,
        )


def test_production_worker_accepts_exact_prod_database_and_storage_identity() -> None:
    assert (
        load_settings(
            media_worker_values(environment="production", database_url=PROD_DATABASE_URL, storage_url=PROD_STORAGE_URL),
            env_file=None,
        ).AI_ENVIRONMENT
        == "production"
    )


def test_worker_environment_file_rejects_cross_environment_database_identity(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    lines = [f'{key}="{value}"' for key, value in media_worker_values().items()]
    lines = [line.replace(DEV_DATABASE_URL, PROD_DATABASE_URL) for line in lines]
    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_settings({}, env_file=env_file)


def test_worker_accepts_only_explicit_disposable_qa_database_and_local_media_source() -> None:
    settings = load_settings(
        media_worker_values(environment="qa", database_url=QA_DATABASE_URL, storage_url=QA_STORAGE_URL),
        env_file=None,
    )
    assert settings.AI_ENVIRONMENT == "qa"
    assert settings.AI_MEDIA_STORAGE_BASE_URL == QA_STORAGE_URL


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://ai_media_worker_runtime:pw@db.pzxekjybdiulzmssalfo.evil.supabase.co:5432/postgres?sslmode=require",
        f"postgresql://ai_media_worker_runtime.{PROD_REF}:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require",
        "postgresql://ai_media_worker_runtime:pw@203.0.113.25:5432/postgres?sslmode=require",
        f"postgresql://ai_media_worker_runtime:pw@db.{DEV_REF}.supabase.co:5432/postgres?sslmode=disable",
        f"postgresql://ai_media_worker_runtime:pw@db.{DEV_REF}.supabase.co:5432/postgres?sslmode=require&hostaddr=203.0.113.25",
        f"postgresql://ai_media_worker_runtime:pw@db.{DEV_REF}.supabase.co:5432/postgres?sslmode=disable&sslmode=require",
        f"postgresql://ai_media_worker_runtime:pw@db.{DEV_REF}.supabase.co:99999/postgres?sslmode=require",
        f"postgresql://ai_media_worker_runtime:pw@db.{DEV_REF}.supabase.co:6543/postgres?sslmode=require",
        f"postgresql://ai_media_worker:pw@db.{DEV_REF}.supabase.co:5432/postgres?sslmode=require",
        f"postgresql://ai_media_worker.{DEV_REF}:pw@aws-1-us-east-2.pooler.supabase.com:6543/postgres?sslmode=require",
        "postgresql://ai_media_worker:pw@localhost:5432/electrohub?sslmode=require",
    ],
)
def test_worker_rejects_malformed_ambiguous_or_non_disposable_database_identity(database_url: str) -> None:
    with pytest.raises(ConfigurationError):
        load_settings(media_worker_values(database_url=database_url), env_file=None)


@pytest.mark.parametrize(
    "name",
    [
        "AI_VECTOR_INGEST_DATABASE_URL",
        "AI_VECTOR_ADMIN_DATABASE_URL",
        "AI_VECTOR_DATABASE_URL",
        "AI_SERVICE_API_KEY",
    ],
)
def test_worker_rejects_ingest_and_admin_dsns_from_process_environment(name: str) -> None:
    values = {**media_worker_values(), name: "postgresql://secret:must-not-leak@localhost/db"}
    with pytest.raises(ConfigurationError) as exc:
        load_settings(values, env_file=None)
    assert name in str(exc.value)
    assert "must-not-leak" not in str(exc.value)


@pytest.mark.parametrize(
    "name",
    [
        "AI_VECTOR_INGEST_DATABASE_URL",
        "AI_VECTOR_ADMIN_DATABASE_URL",
        "AI_VECTOR_DATABASE_URL",
        "AI_SERVICE_API_KEY",
        "STRIPE_SECRET_KEY",
        "BREVO_API_KEY",
        "JWT_SECRET",
        "E2E_TEST_SUPPORT_TOKEN",
    ],
)
def test_worker_rejects_vector_credentials_from_env_file(name: str, tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    lines = [f'{key}="{value}"' for key, value in media_worker_values().items()]
    lines.append(f'{name}="postgresql://secret:env-file-secret@localhost/db"')
    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with pytest.raises(ConfigurationError) as exc:
        load_settings({}, env_file=env_file)
    assert name in str(exc.value)
    assert "env-file-secret" not in str(exc.value)


@pytest.mark.parametrize("name", ["AI_SERVICE_API_KEY", "STRIPE_SECRET_KEY", "BREVO_API_KEY", "JWT_SECRET"])
def test_worker_rejects_api_or_commerce_credentials(name: str) -> None:
    values = {**media_worker_values(), name: "private-not-for-worker"}
    with pytest.raises(ConfigurationError) as exc:
        load_settings(values, env_file=None)
    assert name in str(exc.value)
    assert "private-not-for-worker" not in str(exc.value)


def test_worker_rejects_unapproved_storage_origin_and_hosted_qa_target() -> None:
    with pytest.raises(ConfigurationError):
        load_settings(
            media_worker_values(environment="development", storage_url="https://attacker.example"),
            env_file=None,
        )
    with pytest.raises(ConfigurationError):
        load_settings(
            media_worker_values(environment="qa", database_url=QA_DATABASE_URL, storage_url=DEV_STORAGE_URL),
            env_file=None,
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
