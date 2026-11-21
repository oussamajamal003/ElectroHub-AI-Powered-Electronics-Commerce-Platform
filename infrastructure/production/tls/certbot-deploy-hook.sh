#!/usr/bin/env bash
set -Eeuo pipefail

lineage=${RENEWED_LINEAGE:-}
host=${CANONICAL_HOST:-}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ -z "$lineage" || -z "$host" ]]; then
  echo "Certbot did not provide the renewed lineage and configured hostname." >&2
  exit 64
fi
exec /bin/bash "$script_dir/install-certificate.sh" "$lineage" "$host"
