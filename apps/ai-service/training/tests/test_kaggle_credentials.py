"""Training-only credential source and subprocess isolation; all test values are fake."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "training_kaggle_cli", Path(__file__).resolve().parents[1] / "kaggle_cli.py"
)
assert spec is not None and spec.loader is not None
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def test_default_credentials_are_training_only() -> None:
    assert cli.DEFAULT_ENV.name == "kaggle.env"
    assert cli.DEFAULT_ENV.parent.name == ".data"
    assert cli.DEFAULT_ENV.parent.parent.name == "training"


def test_subprocess_does_not_inherit_serving_or_commerce_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "kaggle.env"
    source.write_text("KAGGLE_API_KEY=KGAT_fake_training_token\nDATABASE_URL=never-forward\n", encoding="utf-8")
    monkeypatch.setenv("KAGGLE_API_TOKEN", "stale-parent-token")
    monkeypatch.setenv("DATABASE_URL", "private-parent-database")
    monkeypatch.setenv("AI_SERVICE_API_KEY", "private-service-key")
    monkeypatch.setenv("PATH", "safe-os-path")
    environment = cli.kaggle_environment(source)
    assert environment["KAGGLE_API_TOKEN"] == "KGAT_fake_training_token"  # noqa: S105 -- deliberately fake test value.
    assert environment["PATH"] == "safe-os-path"
    assert not {"DATABASE_URL", "AI_SERVICE_API_KEY", "KAGGLE_API_KEY"} & environment.keys()
    assert "stale-parent-token" not in environment.values()
