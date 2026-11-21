#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly RELEASE_SHA_RE='^[0-9a-f]{40}$'
readonly BACKUP_REF_RE='^[A-Za-z0-9][A-Za-z0-9._-]{3,199}$'
readonly AUTH_REF_RE='^[A-Za-z0-9][A-Za-z0-9._:/-]{3,199}$'
readonly RELEASE_ROOT=/var/lib/electrohub
readonly COMPOSE_BASE_ENV_FILE=/etc/electrohub/compose.env
readonly BACKUP_EVIDENCE_DIR=${ELECTROHUB_BACKUP_EVIDENCE_DIR:-/var/lib/electrohub/backup-evidence}
readonly LOCK_FILE=/run/lock/electrohub-production-deploy.lock
readonly HOST_HELPER=/usr/local/libexec/electrohub-prepare-release-bundle.py
readonly HOST_ENV_HELPER=/usr/local/libexec/electrohub-verify-production-env.py
readonly HOST_AI_HELPER=/usr/local/libexec/electrohub-verify-model-artifact.py

sha=${1:-}
authorization_ref=${2:-}
backup_ref=${3:-}
if [[ ! "$sha" =~ $RELEASE_SHA_RE || ! "$authorization_ref" =~ $AUTH_REF_RE || ! "$backup_ref" =~ $BACKUP_REF_RE ]]; then
  echo "Usage: deploy-release.sh <approved-full-sha> <authorization-reference> <backup-evidence-reference>" >&2
  exit 64
fi
if [[ $EUID -ne 0 ]]; then
  echo "The host deployment entrypoint must run through the dedicated privileged operator command." >&2
  exit 77
fi
if [[ ! -f "$COMPOSE_BASE_ENV_FILE" || -L "$COMPOSE_BASE_ENV_FILE" ]]; then
  echo "The root-managed production Compose settings file is missing." >&2
  exit 1
fi
compose_env_owner=$(stat -c '%u' "$COMPOSE_BASE_ENV_FILE")
compose_env_mode=$(stat -c '%a' "$COMPOSE_BASE_ENV_FILE")
if [[ "$compose_env_owner" != 0 || ! "$compose_env_mode" =~ ^[0-7]{3,4}$ ]]; then
  echo "The production Compose settings file must be root-owned with a valid permission mode." >&2
  exit 1
fi
compose_env_permissions=$((8#$compose_env_mode))
if (( compose_env_permissions & 0022 )); then
  echo "The production Compose settings file must not be group- or world-writable." >&2
  exit 1
fi
if [[ ! -f "$HOST_HELPER" || -L "$HOST_HELPER" ]]; then
  echo "The fixed root-owned host release guard is missing or is not a regular file." >&2
  exit 1
fi
host_helper_owner=$(stat -c '%u' "$HOST_HELPER")
host_helper_mode=$(stat -c '%a' "$HOST_HELPER")
if [[ "$host_helper_owner" != 0 || ! "$host_helper_mode" =~ ^[0-7]{3,4}$ ]]; then
  echo "The host release guard must be root-owned with a valid permission mode." >&2
  exit 1
fi
host_helper_permissions=$((8#$host_helper_mode))
if (( host_helper_permissions & 0022 )); then
  echo "The host release guard must not be group- or world-writable." >&2
  exit 1
fi
for fixed_helper in "$HOST_ENV_HELPER" "$HOST_AI_HELPER"; do
  if [[ ! -f "$fixed_helper" || -L "$fixed_helper" ]]; then
    echo "A fixed root-owned production preflight tool is missing or is not a regular file: $fixed_helper" >&2
    exit 1
  fi
  fixed_helper_owner=$(stat -c '%u' "$fixed_helper")
  fixed_helper_mode=$(stat -c '%a' "$fixed_helper")
  if [[ "$fixed_helper_owner" != 0 || ! "$fixed_helper_mode" =~ ^[0-7]{3,4}$ ]]; then
    echo "A production preflight tool must be root-owned with a valid permission mode: $fixed_helper" >&2
    exit 1
  fi
  fixed_helper_permissions=$((8#$fixed_helper_mode))
  if (( fixed_helper_permissions & 0022 )); then
    echo "A production preflight tool must not be group- or world-writable: $fixed_helper" >&2
    exit 1
  fi
done

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another ElectroHub production deployment is active." >&2; exit 75; }

readonly release="$RELEASE_ROOT/releases/$sha"
readonly staging="$RELEASE_ROOT/releases/.${sha}.staging-$$"
readonly current="$RELEASE_ROOT/current"
readonly backup_record="$BACKUP_EVIDENCE_DIR/$backup_ref.txt"

if [[ -e "$release" || -L "$release" ]]; then
  echo "This exact release SHA already exists; refusing to overwrite retained release evidence." >&2
  exit 1
fi
if [[ ! -L "$current" || ! -e "$current/source/infrastructure/production/compose.yaml" ]]; then
  echo "Automatic deploy requires an existing healthy release for application rollback; initial bootstrap is a separate approval gate." >&2
  exit 1
fi
previous=$(readlink -e "$current")
if [[ "$previous" != "$RELEASE_ROOT"/releases/* || ! $(basename "$previous") =~ $RELEASE_SHA_RE ]]; then
  echo "The active release pointer is outside the managed release directory." >&2
  exit 1
fi
if [[ ! -s "$backup_record" ]] || ! grep -Fxq "reference=$backup_ref" "$backup_record" \
   || ! grep -Fxq 'environment=production' "$backup_record" \
   || ! grep -Fxq 'target_project_ref=yepfgjehdstlxbpespun' "$backup_record" \
   || ! grep -Eq '^backup_created_utc=[0-9]{4}-[0-9]{2}-[0-9]{2}T' "$backup_record" \
   || ! grep -Eq '^restore_verification_reference=[A-Za-z0-9][A-Za-z0-9._:/-]{3,199}$' "$backup_record"; then
  echo "Required external PROD backup evidence is missing or incomplete; no database was contacted." >&2
  exit 1
fi

cleanup() {
  local original_status=$?
  trap - EXIT
  if [[ -e "$staging" || -L "$staging" ]]; then
    if ! python3 "$HOST_HELPER" cleanup --releases-root "$RELEASE_ROOT/releases" --staging-name ".${sha}.staging-$$"; then
      logger -p daemon.crit -t electrohub-deploy "Private staging cleanup failed for $sha; operator intervention required"
    fi
  fi
  exit "$original_status"
}
trap cleanup EXIT
python3 "$HOST_HELPER" prepare \
  --incoming-root "$RELEASE_ROOT/incoming" \
  --releases-root "$RELEASE_ROOT/releases" \
  --staging-name ".${sha}.staging-$$" \
  --sha "$sha" \
  --config "$COMPOSE_BASE_ENV_FILE"

python3 - "$COMPOSE_BASE_ENV_FILE" "$staging/production.compose.env" "$sha" "$backup_ref" <<'PY'
import os, re, sys
source, target, release_sha, backup_ref = sys.argv[1:]
if not re.fullmatch(r"[0-9a-f]{40}", release_sha) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{3,199}", backup_ref):
    raise SystemExit("Unsafe deployment reference")
lines = open(source, encoding="utf-8").read().splitlines()
for key, value in (("RELEASE_SHA", release_sha), ("PROD_BACKUP_EVIDENCE_REFERENCE", backup_ref)):
    count = sum(line.startswith(key + "=") for line in lines)
    if count > 1:
        raise SystemExit(f"Duplicate non-secret Compose setting: {key}")
    if count == 1:
        lines = [key + "=" + value if line.startswith(key + "=") else line for line in lines]
    else:
        lines.append(key + "=" + value)
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
PY

read_compose_value() {
  python3 - "$staging/production.compose.env" "$1" <<'PY'
import sys
values = {}
for raw in open(sys.argv[1], encoding="utf-8"):
    line = raw.strip()
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
value = values.get(sys.argv[2], "")
if not value or "\n" in value or "\r" in value:
    raise SystemExit("Required Compose setting is absent")
print(value)
PY
}

canonical_host=$(read_compose_value CANONICAL_HOST)
runtime_env_dir=$(python3 - "$staging/production.compose.env" <<'PY'
import pathlib, sys
values = {}
for raw in open(sys.argv[1], encoding="utf-8"):
    line = raw.strip()
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
value = values.get("ELECTROHUB_RUNTIME_ENV_DIR", "/etc/electrohub")
if not value or "\n" in value or "\r" in value or not pathlib.Path(value).is_absolute():
    raise SystemExit("Runtime environment directory must be an absolute host path")
print(value)
PY
)
python3 "$HOST_ENV_HELPER" "$staging/production.compose.env" "$runtime_env_dir" "$canonical_host"
python3 "$HOST_AI_HELPER" --production \
  "$staging/AI_PRODUCTION_RELEASE.json" \
  "$staging/AI_MODEL_ARTIFACT_PRODUCTION.json" \
  "$(read_compose_value PROD_AI_RELEASE_MANIFEST_SHA256)" \
  "$(read_compose_value PROD_AI_MODEL_ARTIFACT_DIRECTORY)" \
  "$(read_compose_value PROD_AI_RELEVANCE_ARTIFACT_DIRECTORY)" \
  "$staging/source"

compose_file="$staging/source/infrastructure/production/compose.yaml"
compose=(docker compose --env-file "$staging/production.compose.env" -f "$compose_file" -p electrohub-production)
python3 "$HOST_HELPER" verify-files --bundle-dir "$staging" --sha "$sha"
"${compose[@]}" config --quiet

docker load --input "$staging/images.tar" >/dev/null
python3 "$HOST_HELPER" verify-loaded --bundle-dir "$staging" --sha "$sha"

mv -- "$staging" "$release"
trap - EXIT
next_link="$RELEASE_ROOT/.current-${sha}-$$"
ln -s "releases/$sha" "$next_link"
mv -Tf -- "$next_link" "$current"

rollback() {
  local failed_status=$?
  local failed_line=${BASH_LINENO[0]:-0}
  trap - ERR
  set +e
  logger -p daemon.err -t electrohub-deploy "Release $sha failed at script line $failed_line with status $failed_status; attempting explicit previous-release recovery"
  if ! python3 "$HOST_HELPER" rollback \
    --releases-root "$RELEASE_ROOT/releases" \
    --current "$current" \
    --previous "$previous" \
    --original-status "$failed_status" \
    --original-line "$failed_line"; then
    logger -p daemon.crit -t electrohub-deploy "Release $sha rollback could not be safely completed; no Compose retry through current was attempted; manual operator recovery required; original failure line=$failed_line status=$failed_status"
  fi
  exit "$failed_status"
}
trap rollback ERR

active_compose=(docker compose --env-file "$current/production.compose.env" -f "$current/source/infrastructure/production/compose.yaml" -p electrohub-production)
"${active_compose[@]}" up -d --no-build --pull never --wait --wait-timeout 300 api ai-service edge
curl --fail --silent --show-error --max-time 10 --resolve "$canonical_host:443:127.0.0.1" "https://$canonical_host/" -o /dev/null
if [[ $(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 --resolve "$canonical_host:443:127.0.0.1" "https://$canonical_host/api/health/ready") != 404 ]]; then
  echo "Public API readiness diagnostics were not denied at the edge." >&2
  false
fi
trap - ERR
logger -p daemon.notice -t electrohub-deploy "Release $sha passed internal readiness and canonical HTTPS smoke checks"
previous_sha=$(basename "$previous")
{
  printf 'release_sha=%s\n' "$sha"
  printf 'previous_release_sha=%s\n' "$previous_sha"
  printf 'authorization_reference=%s\n' "$authorization_ref"
  printf 'backup_evidence_reference=%s\n' "$backup_ref"
  printf 'deployed_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'application_readiness=passed\n'
  printf 'database_migration=not_run\n'
} > "$release/deployment-receipt.txt"
chown root:docker "$release/deployment-receipt.txt"
chmod 0640 "$release/deployment-receipt.txt"

# Retain the active release and four most recent immutable release directories. Image removal is by exact task-owned tag only.
mapfile -t expired < <(python3 - "$RELEASE_ROOT/releases" "$RELEASE_ROOT/current" <<'PY'
import json, os, pathlib, sys
root, current = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).resolve()
items = []
for candidate in root.iterdir():
    if not candidate.is_dir() or candidate.name.startswith(".") or not __import__("re").fullmatch(r"[0-9a-f]{40}", candidate.name):
        continue
    try:
        stamp = json.loads((candidate / "release-manifest.json").read_text(encoding="utf-8"))["createdAt"]
    except Exception:
        continue
    items.append((stamp, candidate.resolve()))
items.sort(reverse=True)
keep = {path for _, path in items[:5]} | {current}
for _, path in items:
    if path not in keep and path.parent == root.resolve():
        print(path.name)
PY
)
for old_sha in "${expired[@]}"; do
  [[ "$old_sha" =~ $RELEASE_SHA_RE ]] || continue
  old_path=$(realpath -e "$RELEASE_ROOT/releases/$old_sha")
  [[ "$old_path" == "$RELEASE_ROOT"/releases/* && "$old_path" != "$current" ]] || continue
  for image in backend ai-service edge; do docker image rm "electrohub/$image:$old_sha" >/dev/null 2>&1 || true; done
  rm -rf -- "$old_path"
done
