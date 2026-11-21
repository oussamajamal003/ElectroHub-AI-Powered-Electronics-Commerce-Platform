#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly TLS_ROOT=${TLS_ROOT:-/etc/electrohub/tls}
readonly COMPOSE_ENV_FILE=${COMPOSE_ENV_FILE:-/var/lib/electrohub/current/production.compose.env}
readonly COMPOSE_FILE=${COMPOSE_FILE:-/var/lib/electrohub/current/source/infrastructure/production/compose.yaml}
readonly LINEAGE=${1:-${RENEWED_LINEAGE:-}}
readonly HOST=${2:-${CANONICAL_HOST:-}}
readonly GROUP_ID=101

if [[ $EUID -ne 0 ]]; then
  echo "Certificate installation must run as root." >&2
  exit 77
fi
if [[ ! "$HOST" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ||
      "$HOST" =~ ^[0-9]+(\.[0-9]+){3}$ || ! -d "$LINEAGE" ||
      ! -r "$LINEAGE/fullchain.pem" || ! -r "$LINEAGE/privkey.pem" ]]; then
  echo "Certificate lineage and canonical DNS hostname are required." >&2
  exit 64
fi

openssl x509 -in "$LINEAGE/fullchain.pem" -noout -checkhost "$HOST" >/dev/null
openssl x509 -in "$LINEAGE/fullchain.pem" -noout -checkend 86400 >/dev/null
cert_key_hash=$(openssl x509 -in "$LINEAGE/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d ' ' -f1)
private_key_hash=$(openssl pkey -in "$LINEAGE/privkey.pem" -pubout -outform DER | sha256sum | cut -d ' ' -f1)
if [[ -z "$cert_key_hash" || "$cert_key_hash" != "$private_key_hash" ]]; then
  echo "Certificate and private key do not match." >&2
  exit 1
fi

install -d -o root -g "$GROUP_ID" -m 0750 "$TLS_ROOT" "$TLS_ROOT/releases"
readonly version=$(sha256sum "$LINEAGE/fullchain.pem" | cut -d ' ' -f1)
readonly release="$TLS_ROOT/releases/$version"
readonly staging="$TLS_ROOT/releases/.${version}.staging-$$"
readonly current="$TLS_ROOT/current"
readonly next="$TLS_ROOT/.current-${version}-$$"
readonly rollback_link="$TLS_ROOT/.current-rollback-$$"
previous=''

cleanup() {
  if [[ -d "$staging" ]]; then rm -rf -- "$staging"; fi
  if [[ -L "$next" ]]; then rm -f -- "$next"; fi
  if [[ -L "$rollback_link" ]]; then rm -f -- "$rollback_link"; fi
}
trap cleanup EXIT

if [[ -e "$release" ]]; then
  cmp -s "$LINEAGE/fullchain.pem" "$release/fullchain.pem" || { echo "Certificate content-address collision; refusing overwrite." >&2; exit 1; }
  cmp -s "$LINEAGE/privkey.pem" "$release/privkey.pem" || { echo "Existing release key differs; refusing overwrite." >&2; exit 1; }
else
  install -d -o root -g "$GROUP_ID" -m 0750 "$staging"
  install -o root -g "$GROUP_ID" -m 0644 "$LINEAGE/fullchain.pem" "$staging/fullchain.pem"
  install -o root -g "$GROUP_ID" -m 0640 "$LINEAGE/privkey.pem" "$staging/privkey.pem"
  mv -- "$staging" "$release"
fi

if [[ -L "$current" ]]; then
  previous=$(readlink -e "$current")
  [[ "$previous" == "$TLS_ROOT"/releases/* ]] || { echo "Current certificate pointer escapes the TLS release directory." >&2; exit 1; }
elif [[ -e "$current" ]]; then
  echo "Current certificate pointer must be a symlink." >&2
  exit 1
fi

ln -s "releases/$version" "$next"
mv -Tf -- "$next" "$current"

compose=(docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" -p electrohub-production)
running=''
compose_check=0
if command -v docker >/dev/null 2>&1 && [[ -r "$COMPOSE_ENV_FILE" && -r "$COMPOSE_FILE" ]]; then
  running=$("${compose[@]}" ps --status running -q edge 2>/dev/null) || compose_check=$?
else
  compose_check=127
fi

if (( compose_check != 0 )) && [[ -n "$previous" ]]; then
  ln -s "$previous" "$rollback_link"
  mv -Tf -- "$rollback_link" "$current"
  echo "Could not verify the active edge after certificate installation; previous pointer restored." >&2
  exit 1
fi
if [[ -z "$running" && -n "$previous" ]]; then
  ln -s "$previous" "$rollback_link"
  mv -Tf -- "$rollback_link" "$current"
  echo "The previous release exists but its edge container is not running; previous pointer restored." >&2
  exit 1
fi

if [[ -n "$running" ]]; then
  if ! "${compose[@]}" exec -T edge nginx -t -c /tmp/electrohub-nginx.conf ||
     ! "${compose[@]}" exec -T edge nginx -s reload -c /tmp/electrohub-nginx.conf; then
    if [[ -n "$previous" ]]; then
      ln -s "$previous" "$rollback_link"
      mv -Tf -- "$rollback_link" "$current"
      "${compose[@]}" exec -T edge nginx -t -c /tmp/electrohub-nginx.conf || true
      "${compose[@]}" exec -T edge nginx -s reload -c /tmp/electrohub-nginx.conf || true
    else
      rm -f -- "$current"
    fi
    logger -p daemon.err -t electrohub-tls "Certificate switch failed validation/reload for $HOST; previous pointer restored"
    exit 1
  fi
fi

logger -p daemon.notice -t electrohub-tls "Certificate release $version installed for $HOST"
