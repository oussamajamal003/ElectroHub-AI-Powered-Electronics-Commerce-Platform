#!/usr/bin/env bash
set -Eeuo pipefail

host=${CANONICAL_HOST:-}
root=${TLS_ROOT:-/etc/electrohub/tls}
warning_seconds=${TLS_EXPIRY_WARNING_SECONDS:-259200}
certificate="$root/current/fullchain.pem"

if [[ ! "$warning_seconds" =~ ^[0-9]+$ || ! -r "$certificate" ]]; then
  echo "TLS certificate is missing or expiry threshold is invalid." >&2
  exit 1
fi
openssl x509 -in "$certificate" -noout -checkhost "$host" >/dev/null
openssl x509 -in "$certificate" -noout -checkend "$warning_seconds" >/dev/null
