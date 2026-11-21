"""Offline regression tests for the deployment preflight; no secrets or network access."""

from __future__ import annotations

import tempfile
import unittest
import importlib.util
from pathlib import Path

_module_spec = importlib.util.spec_from_file_location("verify_production_env", Path(__file__).with_name("verify-production-env.py"))
assert _module_spec and _module_spec.loader
_module = importlib.util.module_from_spec(_module_spec)
_module_spec.loader.exec_module(_module)
check_files = _module.check_files


PROJECT = "yepfgjehdstlxbpespun"
HOST = "shop.example.test"
ORIGIN = f"https://{HOST}"


class ProductionEnvironmentPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.compose = root / "compose.env"
        self.runtime = root / "runtime"
        self.runtime.mkdir()
        self.compose.write_text(
            f"EXPECTED_PROD_PROJECT_REF={PROJECT}\nCANONICAL_HOST={HOST}\nPROD_AI_RELEASE_MANIFEST_SHA256={'a' * 64}\nPROD_BACKUP_EVIDENCE_REFERENCE=backup-2026-11-17\n",
            encoding="utf-8",
        )
        backend = {
            "NODE_ENV": "production",
            "FRONTEND_URL": ORIGIN,
            "COMMERCE_EMAIL_ORIGIN": ORIGIN,
            "JWT_SECRET": "c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605",
            "OTP_HASH_SECRET": "R7m$4Qx!9Vn#2Pk@6Dz^1Hb&8Lf+3Cs5Wn9P",
            "BREVO_API_KEY": "xkeysib-7F2mQ4!vK9pL3zA6R1nX8cD5+G0h",
            "SUPABASE_PROJECT_REF": PROJECT,
            "SUPABASE_URL": f"https://{PROJECT}.supabase.co",
            "DATABASE_URL": f"postgresql://postgres.{PROJECT}:placeholder@region.pooler.supabase.com:6543/postgres?sslmode=require",
            "DIRECT_URL": f"postgresql://postgres:placeholder@db.{PROJECT}.supabase.co:5432/postgres?sslmode=require",
        }
        ai = {
            "AI_ENVIRONMENT": "production",
            "AI_PROCESS_ROLE": "api",
            "AI_SERVICE_API_KEY": "test-only-random-value-not-a-real-credential",
            "AI_VECTOR_DATABASE_URL": f"postgresql://reader:placeholder@db.{PROJECT}.supabase.co:5432/postgres?sslmode=verify-full",
        }
        self.write_env(self.runtime / "backend-api.env", backend)
        self.write_env(self.runtime / "ai-api.env", ai)

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def write_env(path: Path, values: dict[str, str]) -> None:
        path.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")

    def test_accepts_shape_valid_target_and_same_origin_contract(self) -> None:
        check_files(self.compose, self.runtime, HOST)

    def test_rejects_ip_host_wrong_origin_wrong_project_and_live_stripe(self) -> None:
        for hostname in ("203.0.113.7", "UPPER.example.test", "host.example.test."):
            with self.subTest(hostname=hostname), self.assertRaises(ValueError):
                check_files(self.compose, self.runtime, hostname)

        backend = {
            "NODE_ENV": "production", "FRONTEND_URL": "https://other.example.test",
            "JWT_SECRET": "c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605",
            "OTP_HASH_SECRET": "R7m$4Qx!9Vn#2Pk@6Dz^1Hb&8Lf+3Cs5Wn9P",
            "BREVO_API_KEY": "xkeysib-7F2mQ4!vK9pL3zA6R1nX8cD5+G0h",
            "SUPABASE_PROJECT_REF": PROJECT, "SUPABASE_URL": f"https://{PROJECT}.supabase.co",
            "DATABASE_URL": f"postgresql://postgres.{PROJECT}:p@region.pooler.supabase.com:6543/postgres?sslmode=require",
            "DIRECT_URL": f"postgresql://postgres:p@db.{PROJECT}.supabase.co:5432/postgres?sslmode=require",
        }
        self.write_env(self.runtime / "backend-api.env", backend)
        with self.assertRaisesRegex(ValueError, "single canonical HTTPS origin"):
            check_files(self.compose, self.runtime, HOST)

        backend["FRONTEND_URL"] = ORIGIN
        backend["STRIPE_SECRET_KEY"] = "sk_live_not-a-real-key"
        self.write_env(self.runtime / "backend-api.env", backend)
        with self.assertRaisesRegex(ValueError, "Test Mode"):
            check_files(self.compose, self.runtime, HOST)

    def test_requires_workers_and_bootstrap_disabled_in_candidate(self) -> None:
        backend = {
            "NODE_ENV": "production", "FRONTEND_URL": ORIGIN, "SUPABASE_PROJECT_REF": PROJECT,
            "JWT_SECRET": "c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605",
            "OTP_HASH_SECRET": "R7m$4Qx!9Vn#2Pk@6Dz^1Hb&8Lf+3Cs5Wn9P",
            "BREVO_API_KEY": "xkeysib-7F2mQ4!vK9pL3zA6R1nX8cD5+G0h",
            "SUPABASE_URL": f"https://{PROJECT}.supabase.co",
            "DATABASE_URL": f"postgresql://postgres.{PROJECT}:p@region.pooler.supabase.com:6543/postgres?sslmode=require",
            "DIRECT_URL": f"postgresql://postgres:p@db.{PROJECT}.supabase.co:5432/postgres?sslmode=require",
            "COMMERCE_EMAIL_DISPATCH_ENABLED": "true",
        }
        self.write_env(self.runtime / "backend-api.env", backend)
        with self.assertRaisesRegex(ValueError, "COMMERCE_EMAIL_DISPATCH_ENABLED"):
            check_files(self.compose, self.runtime, HOST)

    def test_rejects_database_connections_without_explicit_tls(self) -> None:
        backend = {
            "NODE_ENV": "production",
            "FRONTEND_URL": ORIGIN,
            "JWT_SECRET": "c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605c8f3e4a7d19b2605",
            "OTP_HASH_SECRET": "R7m$4Qx!9Vn#2Pk@6Dz^1Hb&8Lf+3Cs5Wn9P",
            "BREVO_API_KEY": "xkeysib-7F2mQ4!vK9pL3zA6R1nX8cD5+G0h",
            "SUPABASE_PROJECT_REF": PROJECT,
            "SUPABASE_URL": f"https://{PROJECT}.supabase.co",
            "DATABASE_URL": f"postgresql://postgres.{PROJECT}:p@db.{PROJECT}.supabase.co:5432/postgres?sslmode=prefer",
            "DIRECT_URL": f"postgresql://postgres:p@db.{PROJECT}.supabase.co:5432/postgres?sslmode=require",
        }
        self.write_env(self.runtime / "backend-api.env", backend)
        with self.assertRaisesRegex(ValueError, "project and require TLS"):
            check_files(self.compose, self.runtime, HOST)

    def test_otp_secret_policy_rejects_placeholder_short_repeated_and_predictable_values(self) -> None:
        backend = _module.read_env(self.runtime / "backend-api.env")
        original_jwt = backend["JWT_SECRET"]
        for value in (
            "REPLACE_WITH_UNIQUE_RANDOM_VALUE",
            "",
            "short-otp-key",
            "a" * 32,
            "0123456789abcdefghijklmnopqrstuvwxyz",
            original_jwt,
        ):
            backend["OTP_HASH_SECRET"] = value
            self.write_env(self.runtime / "backend-api.env", backend)
            with self.subTest(value="[redacted]"), self.assertRaisesRegex(ValueError, "OTP_HASH_SECRET") as caught:
                check_files(self.compose, self.runtime, HOST)
            if value:
                self.assertNotIn(value, str(caught.exception))

    def test_otp_secret_must_differ_from_refresh_token_signing_secret(self) -> None:
        backend = _module.read_env(self.runtime / "backend-api.env")
        backend["JWT_REFRESH_SECRET"] = backend["OTP_HASH_SECRET"]
        self.write_env(self.runtime / "backend-api.env", backend)
        with self.assertRaisesRegex(ValueError, "OTP_HASH_SECRET"):
            check_files(self.compose, self.runtime, HOST)

    def test_rejects_brevo_placeholder_without_echoing_value(self) -> None:
        backend = _module.read_env(self.runtime / "backend-api.env")
        secret = "REPLACE_WITH_SERVER_SIDE_SECRET"
        backend["BREVO_API_KEY"] = secret
        self.write_env(self.runtime / "backend-api.env", backend)
        with self.assertRaisesRegex(ValueError, "BREVO_API_KEY") as caught:
            check_files(self.compose, self.runtime, HOST)
        self.assertNotIn(secret, str(caught.exception))

    def test_rejects_weak_or_unresolved_ai_service_keys_without_echoing_value(self) -> None:
        ai = _module.read_env(self.runtime / "ai-api.env")
        for secret in ("", "short", "REPLACE_WITH_UNIQUE_RANDOM_VALUE", "x" * 40):
            ai["AI_SERVICE_API_KEY"] = secret
            self.write_env(self.runtime / "ai-api.env", ai)
            with self.subTest(secret="[redacted]"), self.assertRaisesRegex(ValueError, "AI_SERVICE_API_KEY") as caught:
                check_files(self.compose, self.runtime, HOST)
            if secret:
                self.assertNotIn(secret, str(caught.exception))

    def test_requires_a_valid_host_pinned_ai_release_identity(self) -> None:
        for value in ("", "REPLACE_WITH_APPROVED_RELEASE_SHA256", "a" * 63, "g" * 64):
            self.compose.write_text(
                f"EXPECTED_PROD_PROJECT_REF={PROJECT}\nCANONICAL_HOST={HOST}\nPROD_AI_RELEASE_MANIFEST_SHA256={value}\nPROD_BACKUP_EVIDENCE_REFERENCE=backup-2026-11-17\n",
                encoding="utf-8",
            )
            with self.subTest(value="[redacted]"), self.assertRaisesRegex(ValueError, "root-managed approved production AI release"):
                check_files(self.compose, self.runtime, HOST)


if __name__ == "__main__":
    unittest.main()
