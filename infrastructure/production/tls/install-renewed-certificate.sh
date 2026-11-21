#!/usr/bin/env bash
set -euo pipefail
umask 077

tls_env=${ELECTROHUB_TLS_ENV_FILE:-/etc/electrohub/tls.env}
if [[ ! -r "$tls_env" ]]; then
  logger -p daemon.err -t electrohub-tls "TLS environment file is unavailable"
  exit 78
fi
set -a
# shellcheck disable=SC1090
. "$tls_env"
set +a

lineage=${RENEWED_LINEAGE:-${1:-}}
if [[ -z "$lineage" || ! -r "$lineage/fullchain.pem" || ! -r "$lineage/privkey.pem" ]]; then
  logger -p daemon.err -t electrohub-tls "Renewed certificate files are unavailable"
  exit 1
fi
: "${CANONICAL_HOST:?Set the approved canonical hostname}"
: "${PROD_TLS_DIRECTORY:?Set the versioned TLS directory}"
: "${COMPOSE_ENV_FILE:?Set the external Compose environment file}"
: "${COMPOSE_FILE:?Set the current release Compose file}"

exec 9>/run/lock/electrohub-tls-install.lock
flock -n 9 || { logger -p daemon.err -t electrohub-tls "Another TLS install is running"; exit 1; }

openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost "$CANONICAL_HOST" >/dev/null
openssl x509 -in "$lineage/fullchain.pem" -noout -checkend 3600 >/dev/null
openssl pkey -in "$lineage/privkey.pem" -noout >/dev/null
cert_key=$(openssl x509 -in "$lineage/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
private_key=$(openssl pkey -in "$lineage/privkey.pem" -pubout -outform DER | sha256sum | cut -d' ' -f1)
if [[ "$cert_key" != "$private_key" ]]; then
  logger -p daemon.err -t electrohub-tls "Renewed certificate and private key do not match"
  exit 1
fi

serial=$(openssl x509 -in "$lineage/fullchain.pem" -noout -serial | cut -d= -f2 | tr '[:upper:]' '[:lower:]')
if [[ ! "$serial" =~ ^[a-f0-9]+$ ]]; then
  logger -p daemon.err -t electrohub-tls "Certificate serial is invalid"
  exit 1
fi
releases="$PROD_TLS_DIRECTORY/releases"
install -d -o root -g 101 -m 0750 "$PROD_TLS_DIRECTORY" "$releases"
stage="$releases/.${serial}.$$"
target="$releases/$serial"
mkdir -m 0750 "$stage"
chown root:101 "$stage"
install -o root -g 101 -m 0640 "$lineage/fullchain.pem" "$stage/fullchain.pem"
install -o root -g 101 -m 0640 "$lineage/privkey.pem" "$stage/privkey.pem"
if [[ -e "$target" ]]; then
  rm -- "$stage/fullchain.pem" "$stage/privkey.pem"
  rmdir -- "$stage"
else
  mv -- "$stage" "$target"
fi

previous=$(readlink "$PROD_TLS_DIRECTORY/current" 2>/dev/null || true)
next_link="$PROD_TLS_DIRECTORY/.current-new-$$"
ln -s "releases/$serial" "$next_link"
mv -Tf -- "$next_link" "$PROD_TLS_DIRECTORY/current"

compose=(docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE")
if "${compose[@]}" ps --status running --services | grep -qx edge; then
  if "${compose[@]}" exec -T edge nginx -t -c /tmp/electrohub-nginx.conf >/dev/null; then
    if "${compose[@]}" exec -T edge nginx -c /tmp/electrohub-nginx.conf -s reload; then
      logger -p daemon.notice -t electrohub-tls "Renewed certificate installed and Nginx reloaded"
      exit 0
    fi
  fi

  if [[ -n "$previous" ]]; then
    rollback_link="$PROD_TLS_DIRECTORY/.current-rollback-$$"
    ln -s "$previous" "$rollback_link"
    mv -Tf -- "$rollback_link" "$PROD_TLS_DIRECTORY/current"
    "${compose[@]}" exec -T edge nginx -c /tmp/electrohub-nginx.conf -s reload || true
  fi
  logger -p daemon.err -t electrohub-tls "Nginx rejected the renewed certificate; the previous certificate pointer was restored"
  exit 1
fi

# First boot has no HTTPS container yet. The image entrypoint runs nginx -t before starting it.
logger -p daemon.notice -t electrohub-tls "Certificate installed; HTTPS edge startup will validate Nginx before serving"
