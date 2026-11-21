#!/bin/sh
set -eu

mode=${1:-https}
if [ "$mode" != https ] && [ "$mode" != acme-bootstrap ]; then
  echo "ElectroHub edge mode is invalid." >&2
  exit 64
fi

host=${CANONICAL_HOST:-}
if [ -z "$host" ] || [ "${#host}" -gt 253 ] || [ "$host" != "$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')" ]; then
  echo "CANONICAL_HOST must be a lowercase DNS hostname without a scheme, port, path, or trailing dot." >&2
  exit 64
fi
if ! printf '%s\n' "$host" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'; then
  echo "CANONICAL_HOST is not a valid fully qualified DNS hostname." >&2
  exit 64
fi
if printf '%s\n' "$host" | grep -Eq '^[0-9]+(\.[0-9]+){3}$'; then
  echo "CANONICAL_HOST must be a DNS name, not an IP address." >&2
  exit 64
fi

if [ "$mode" = acme-bootstrap ]; then
  template=/etc/electrohub/nginx-acme-bootstrap.conf.template
else
  template=/etc/electrohub/nginx.conf.template
fi
config=/tmp/electrohub-nginx.conf
envsubst '${CANONICAL_HOST}' < "$template" > "$config"
nginx -t -c "$config"
exec nginx -c "$config" -g 'daemon off;'
