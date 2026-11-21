


"""Offline shape/identity checks for operator-provided production env files; makes no network calls."""

from __future__ import annotations

import ipaddress
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


EXPECTED_REF = "yepfgjehdstlxbpespun"
OTP_SECRET_MIN_BYTES = 32
UNRESOLVED_SECRET = re.compile(
    r"(?:replace[-_ ]?with|change[-_ ]?me|your[-_ ]|placeholder|sample|example|dummy|default|"
    r"password|server[-_ ]side[-_ ]secret)",
    re.IGNORECASE,
)


def is_strong_otp_secret(value: str | None) -> bool:
    if not value or value != value.strip() or len(value.encode("utf-8")) < OTP_SECRET_MIN_BYTES:
        return False
    if UNRESOLVED_SECRET.search(value) or re.fullmatch(r"(.)\1+", value) or re.search(r"(.{8,})\1+$", value):
        return False
    if re.search(r"(?:0123456789|9876543210|abcdefghijklmnopqrstuvwxyz|qwertyuiop|asdfghjkl)", value, re.IGNORECASE):
        return False
    return len(set(value)) >= 12


def is_valid_jwt_secret(value: str | None) -> bool:
    # Match the backend's existing JWT contract: 32+ characters, no templates, and at least eight distinct characters.
    if not value or len(value) < 32 or value != value.strip() or UNRESOLVED_SECRET.search(value):
        return False
    return len(set(value)) >= 8 and not re.fullmatch(r"(.)\1+", value)


def is_valid_ai_service_key(value: str | None) -> bool:
    if not value or len(value) < 32 or value != value.strip() or not re.fullmatch(r"[\x21-\x7e]+", value):
        return False
    if UNRESOLVED_SECRET.search(value) or "xxxxxxxx" in value.lower() or re.fullmatch(r"(.)\1+", value):
        return False
    return len(set(value)) >= 8


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.startswith("export "):
            name = name[7:].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[name.strip()] = value
    return values


def belongs_to_project(value: str | None, ref: str) -> bool:
    if not value:
        return False
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        username = unquote(parsed.username or "")
    except ValueError:
        return False
    if parsed.scheme not in {"postgres", "postgresql"} or not host or not username:
        return False
    ssl_modes = parse_qs(parsed.query, keep_blank_values=True).get("sslmode", [])
    if len(ssl_modes) != 1 or ssl_modes[0].lower() not in {"require", "verify-ca", "verify-full"}:
        return False
    if host == f"db.{ref}.supabase.co":
        return True
    return host.endswith(".pooler.supabase.com") and username.endswith(f".{ref}")


def check_files(compose_file: Path, runtime_dir: Path, hostname: str) -> None:
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValueError("The canonical host must be a DNS name, not an IP address")
    if (hostname != hostname.lower() or hostname.endswith(".") or "." not in hostname
            or len(hostname) > 253 or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+", hostname)):
        raise ValueError("The canonical host must be a lowercase fully qualified DNS name")

    compose = read_env(compose_file)
    expected_ref = compose.get("EXPECTED_PROD_PROJECT_REF")
    if expected_ref != EXPECTED_REF:
        raise ValueError("Compose target identity does not match the repository's expected PROD project reference")
    if compose.get("CANONICAL_HOST") != hostname:
        raise ValueError("Compose canonical host does not match the approved host")
    if not re.fullmatch(r"[a-f0-9]{64}", compose.get("PROD_AI_RELEASE_MANIFEST_SHA256", "")):
        raise ValueError("A root-managed approved production AI release manifest SHA-256 pin is required")
    backup_reference = compose.get("PROD_BACKUP_EVIDENCE_REFERENCE", "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{3,199}", backup_reference) or backup_reference.startswith("REPLACE_WITH"):
        raise ValueError("A reviewed external pre-deploy backup evidence reference is required")

    backend = read_env(runtime_dir / "backend-api.env")
    origin = f"https://{hostname}"
    if backend.get("NODE_ENV") != "production" or backend.get("FRONTEND_URL") != origin:
        raise ValueError("The backend must use production mode and the exact single canonical HTTPS origin")
    if not is_valid_jwt_secret(backend.get("JWT_SECRET")):
        raise ValueError("JWT_SECRET must meet the production secret policy")
    if (
        not is_strong_otp_secret(backend.get("OTP_HASH_SECRET"))
        or backend.get("OTP_HASH_SECRET") in {backend.get("JWT_SECRET"), backend.get("JWT_REFRESH_SECRET")}
    ):
        raise ValueError("OTP_HASH_SECRET must meet the production HMAC secret policy and differ from JWT signing secrets")
    if not backend.get("BREVO_API_KEY") or UNRESOLVED_SECRET.search(backend["BREVO_API_KEY"]):
        raise ValueError("BREVO_API_KEY must be configured and must not contain an unresolved placeholder")
    disabled_controls = {
        "COMMERCE_EMAIL_ENQUEUE_ENABLED": "false",
        "COMMERCE_EMAIL_DISPATCH_ENABLED": "false",
        "COMMERCE_EMAIL_SEND_MODE": "disabled",
        "CUSTOMER_PUSH_ENABLED": "false",
        "ADMIN_SEED_PROVISIONING_ENABLED": "false",
        "ADMIN_BOOTSTRAP_ENABLED": "false",
    }
    for key, expected in disabled_controls.items():
        if backend.get(key, expected).lower() != expected:
            raise ValueError(f"{key} must remain {expected} in this deployment candidate")
    if backend.get("COMMERCE_EMAIL_ORIGIN") and backend["COMMERCE_EMAIL_ORIGIN"] != origin:
        raise ValueError("Email links must use the canonical HTTPS origin")
    google_values = [backend.get("GOOGLE_CLIENT_ID"), backend.get("GOOGLE_CLIENT_SECRET"), backend.get("GOOGLE_REDIRECT_URI")]
    if any(google_values) and not all(google_values):
        raise ValueError("Google OAuth settings must be configured together")
    if all(google_values) and backend["GOOGLE_REDIRECT_URI"] != f"{origin}/api/auth/google/callback":
        raise ValueError("Google OAuth callback must use the canonical origin and callback path")

    if backend.get("SUPABASE_PROJECT_REF") != expected_ref or backend.get("SUPABASE_URL") != f"https://{expected_ref}.supabase.co":
        raise ValueError("The backend Supabase project settings do not match the configured PROD project identity")
    for key in ("DATABASE_URL", "DIRECT_URL"):
        if not belongs_to_project(backend.get(key), expected_ref):
            raise ValueError(f"The backend {key} must identify the configured PROD project and require TLS")
    stripe_key = backend.get("STRIPE_SECRET_KEY", "")
    if stripe_key and not stripe_key.startswith(("sk_test_", "rk_test_")):
        raise ValueError("Only Stripe Test Mode credentials are allowed in this repository candidate")
    if backend.get("STRIPE_SECRET_KEY", "").startswith("REPLACE_WITH"):
        raise ValueError("Stripe Test Mode credentials must not be an unresolved placeholder")

    ai = read_env(runtime_dir / "ai-api.env")
    if ai.get("AI_ENVIRONMENT") != "production" or ai.get("AI_PROCESS_ROLE") != "api":
        raise ValueError("The private AI API must have production identity and a service credential")
    if not is_valid_ai_service_key(ai.get("AI_SERVICE_API_KEY")):
        raise ValueError("AI_SERVICE_API_KEY must meet the production service-key policy")
    if not belongs_to_project(ai.get("AI_VECTOR_DATABASE_URL"), expected_ref):
        raise ValueError("The AI vector reader must identify the configured PROD project")


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: verify-production-env.py <compose-env-file> <runtime-env-dir> <canonical-host>", file=sys.stderr)
        return 64
    try:
        check_files(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
    except (OSError, ValueError) as error:
        print(f"Production preflight failed: {error}", file=sys.stderr)
        return 1
    print("Production environment shape and repository target identity validated offline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
