#!/usr/bin/env bash
set -euo pipefail

tls_env=${ELECTROHUB_TLS_ENV_FILE:-/etc/electrohub/tls.env}
if [[ ! -r "$tls_env" ]]; then
  logger -p daemon.err -t electrohub-tls "TLS environment file is unavailable"
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$tls_env"
set +a

certificate="${PROD_TLS_DIRECTORY:?Set the versioned TLS directory}/current/fullchain.pem"
if [[ ! -r "$certificate" ]] || ! openssl x509 -in "$certificate" -noout -checkend 259200 >/dev/null; then
  logger -p daemon.crit -t electrohub-tls "The active certificate is missing or expires within 72 hours; investigate renewal immediately"
  exit 1
fi
logger -p daemon.info -t electrohub-tls "Active TLS certificate expiry is outside the 72-hour alert window"
