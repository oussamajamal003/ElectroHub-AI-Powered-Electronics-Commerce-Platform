#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly TARGET=/usr/local/sbin/electrohub-deploy-release
readonly HELPER_TARGET=/usr/local/libexec/electrohub-prepare-release-bundle.py
readonly ENV_HELPER_TARGET=/usr/local/libexec/electrohub-verify-production-env.py
readonly AI_HELPER_TARGET=/usr/local/libexec/electrohub-verify-model-artifact.py
readonly SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly SOURCE="$SCRIPT_DIR/deploy-release.sh"
readonly HELPER_SOURCE="$SCRIPT_DIR/prepare-release-bundle.py"
readonly ENV_HELPER_SOURCE="$SCRIPT_DIR/verify-production-env.py"
readonly AI_HELPER_SOURCE="$SCRIPT_DIR/../../apps/ai-service/verify-model-artifact.py"

if [[ $EUID -ne 0 ]]; then
  echo "Install the fixed deployment command as root during separately approved host bootstrap." >&2
  exit 77
fi
if [[ ! -f "$SOURCE" || -L "$SOURCE" || ! -f "$HELPER_SOURCE" || -L "$HELPER_SOURCE" \
   || ! -f "$ENV_HELPER_SOURCE" || -L "$ENV_HELPER_SOURCE" \
   || ! -f "$AI_HELPER_SOURCE" || -L "$AI_HELPER_SOURCE" ]]; then
  echo "A repository deployment command or host release guard is missing or not a regular file." >&2
  exit 66
fi

install -d -o root -g root -m 0755 "$(dirname -- "$TARGET")" "$(dirname -- "$HELPER_TARGET")"
staged_paths=()
cleanup() { for staged in "${staged_paths[@]:-}"; do rm -f -- "$staged"; done; }
trap cleanup EXIT

# Refuse every existing mismatch before installing either file. This keeps a
# partial prior install recoverable without silently replacing host tooling.
for pair in \
  "$HELPER_SOURCE|$HELPER_TARGET" \
  "$ENV_HELPER_SOURCE|$ENV_HELPER_TARGET" \
  "$AI_HELPER_SOURCE|$AI_HELPER_TARGET" \
  "$SOURCE|$TARGET"; do
  source=${pair%%|*}
  target=${pair#*|}
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ ! -f "$target" || -L "$target" ]] || ! cmp -s "$source" "$target"; then
      echo "A different host release file already exists; refusing to replace it automatically: $target" >&2
      exit 65
    fi
    target_owner=$(stat -c '%u' "$target")
    target_mode=$(stat -c '%a' "$target")
    expected_mode=640
    [[ "$target" == "$TARGET" ]] && expected_mode=750
    if [[ "$target_owner" != 0 || "$target_mode" != "$expected_mode" ]]; then
      echo "An existing host release file has unexpected ownership or mode: $target" >&2
      exit 65
    fi
  fi
done

for pair in \
  "$HELPER_SOURCE|$HELPER_TARGET|0640" \
  "$ENV_HELPER_SOURCE|$ENV_HELPER_TARGET|0640" \
  "$AI_HELPER_SOURCE|$AI_HELPER_TARGET|0640" \
  "$SOURCE|$TARGET|0750"; do
  source=${pair%%|*}
  remainder=${pair#*|}
  target=${remainder%%|*}
  mode=${remainder##*|}
  if [[ -e "$target" ]]; then
    continue
  fi
  staged="$target.install-$$"
  staged_paths+=("$staged")
  source_digest=$(sha256sum "$source" | cut -d ' ' -f1)
  install -o root -g root -m "$mode" "$source" "$staged"
  if [[ $(sha256sum "$staged" | cut -d ' ' -f1) != "$source_digest" ]]; then
    echo "Installed host release file checksum differs from the reviewed source: $target" >&2
    exit 1
  fi
  # Hard-link creation is atomic and fails if another path already exists.
  ln -- "$staged" "$target"
  rm -- "$staged"
done

trap - EXIT
echo "Installed the fixed deployment command, release guard and production preflight tools from reviewed repository sources."
