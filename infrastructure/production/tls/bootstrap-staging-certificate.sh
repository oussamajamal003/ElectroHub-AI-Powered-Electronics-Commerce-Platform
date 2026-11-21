#!/usr/bin/env bash
set -euo pipefail

tls_env=${ELECTROHUB_TLS_ENV_FILE:-/etc/electrohub/tls.env}
if [[ ! -r "$tls_env" ]]; then
  echo "ElectroHub TLS environment file is missing." >&2
  exit 78
fi
# This file is a names-only host configuration, never a secrets file.
set -a
# shellcheck disable=SC1090
. "$tls_env"
set +a

# Starting the HTTP challenge listener requires a separately approved staging exercise.
if [[ "${ACME_STAGING_ONLY:-false}" != true ]]; then
  echo "Set ACME_STAGING_ONLY=true only for a separately approved staging exercise." >&2
  exit 77
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run this host helper as root after host prerequisites are installed." >&2
  exit 77
fi

: "${CANONICAL_HOST:?Set the approved canonical DNS hostname}"
: "${ACME_CONTACT_EMAIL:?Set the monitored operations contact}"
: "${PROD_ACME_WEBROOT:?Set the ACME webroot}"
: "${COMPOSE_ENV_FILE:?Set the external Compose environment file}"
: "${COMPOSE_FILE:?Set the current release Compose file}"

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
installer=${TLS_INSTALLER:-$script_dir/install-certificate.sh}
certbot=${CERTBOT_BIN:-certbot}
if [[ ! -r "$installer" ]]; then
  echo "The repository certificate installer is unavailable." >&2
  exit 64
fi

mkdir -p "$PROD_ACME_WEBROOT" "${PROD_TLS_DIRECTORY:?Set the TLS directory}/releases"
chown root:101 "$PROD_ACME_WEBROOT" "$PROD_TLS_DIRECTORY" "$PROD_TLS_DIRECTORY/releases"
chmod 0750 "$PROD_ACME_WEBROOT"
chmod 0750 "$PROD_TLS_DIRECTORY" "$PROD_TLS_DIRECTORY/releases"

compose=(docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE")
if "${compose[@]}" ps --status running --services | grep -qx edge; then
  echo "Stop the HTTPS edge before starting the ACME-only bootstrap edge." >&2
  exit 1
fi

# Bootstrap binds HTTP only and serves only the HTTP-01 challenge directory; it never serves the app.
cleanup() { "${compose[@]}" --profile acme-bootstrap stop edge-acme-bootstrap >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${compose[@]}" --profile acme-bootstrap up -d --no-build --pull never edge-acme-bootstrap

# Staging is hard-coded. Public issuance is a later, separately authorized operator action.
"$certbot" certonly --staging --webroot --webroot-path "$PROD_ACME_WEBROOT" \
  --non-interactive --agree-tos --email "$ACME_CONTACT_EMAIL" \
  --cert-name "$CANONICAL_HOST" -d "$CANONICAL_HOST"

/bin/bash "$installer" "/etc/letsencrypt/live/$CANONICAL_HOST" "$CANONICAL_HOST"

echo "ACME staging certificate installed. It is not browser-trusted; do not serve the public app with it."
