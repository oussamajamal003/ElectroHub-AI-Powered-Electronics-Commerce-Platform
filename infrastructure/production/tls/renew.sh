#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${TLS_RENEWAL_ENABLED:-false}" != true ]]; then
  echo "TLS renewal is disabled until separately authorized host setup." >&2
  exit 77
fi
if [[ $EUID -ne 0 ]]; then
  echo "Certificate renewal must run as root." >&2
  exit 77
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
deploy_hook="$script_dir/certbot-deploy-hook.sh"
if [[ ! "${CANONICAL_HOST:-}" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ||
      "$CANONICAL_HOST" =~ ^[0-9]+(\.[0-9]+){3}$ || ! -r "$deploy_hook" ]]; then
  echo "Canonical DNS hostname or installed Certbot deploy hook is missing." >&2
  exit 64
fi

exec 9>/run/lock/electrohub-certbot-renew.lock
flock -n 9 || { echo "Another ElectroHub certificate renewal is active." >&2; exit 75; }
certbot renew --quiet --deploy-hook "/bin/bash $deploy_hook"
