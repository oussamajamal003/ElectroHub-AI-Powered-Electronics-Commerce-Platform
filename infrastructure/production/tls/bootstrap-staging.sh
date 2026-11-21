#!/usr/bin/env bash
set -Eeuo pipefail

tls_env=${ELECTROHUB_TLS_ENV_FILE:-/etc/electrohub/tls.env}
if [[ ! -r "$tls_env" ]]; then
  echo "ElectroHub TLS environment file is missing." >&2
  exit 78
fi
set -a
# shellcheck disable=SC1090
. "$tls_env"
set +a

# Candidate-only first-boot helper. It can obtain only an ACME staging certificate.
# Starting the ACME edge and publishing port 80 require separate operator approval.
if [[ "${ACME_STAGING_ONLY:-false}" != true ]]; then
  echo "Set ACME_STAGING_ONLY=true only for a separately approved staging exercise." >&2
  exit 77
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run this host helper as root after the ACME-only edge is prepared." >&2
  exit 77
fi

host=${CANONICAL_HOST:-}
email=${ACME_CONTACT_EMAIL:-}
webroot=${PROD_ACME_WEBROOT:-}
certbot=${CERTBOT_BIN:-certbot}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
installer=${TLS_INSTALLER:-$script_dir/install-certificate.sh}

if [[ ! "$host" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ||
      "$host" =~ ^[0-9]+(\.[0-9]+){3}$ || ! "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ||
      "$webroot" != /var/lib/electrohub/acme || ! -d "$webroot" || ! -r "$installer" ]]; then
  echo "Canonical host, contact, approved ACME webroot, or certificate installer is invalid." >&2
  exit 64
fi

"$certbot" certonly --non-interactive --agree-tos --no-eff-email --staging \
  --webroot --webroot-path "$webroot" --email "$email" --cert-name "$host" -d "$host"
/bin/bash "$installer" "/etc/letsencrypt/live/$host" "$host"
