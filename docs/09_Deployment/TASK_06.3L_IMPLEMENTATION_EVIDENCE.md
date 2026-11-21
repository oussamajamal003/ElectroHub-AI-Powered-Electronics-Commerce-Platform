# Task 06.3L — Implementation Evidence

## Result

**PARTIAL — BLOCKED BY TRUST-OWNER DECISION.** The archive permission correction and local Linux verification are complete. The release provenance blocker remains unresolved; production deployment stays **NO-GO**.

## Git state and preservation

- Branch: `feature/06.3-production-infrastructure`
- HEAD: `053a271ba36ebcf436720bdc6aa87c7bb79cf149`
- `develop` and local `origin/feature/06.3-production-infrastructure` were present; merge base with `develop`: `053a271ba36ebcf436720bdc6aa87c7bb79cf149`.
- No fetch or remote mutation was performed.
- The recorded pre-Task-06.3L baseline contained 37 modified tracked paths, 93 untracked files, and no staged paths. All accumulated Task 06.3 and unrelated worktree paths were preserved.
- The final status has 37 modified tracked paths, 95 untracked files (the previous 93 plus these two reports), zero staged paths, and no Task 06.3L-created deletions or renames. Git collapses some untracked directories in its short-status display; the file count is from `git ls-files --others --exclude-standard`.
- No path was staged, committed, pushed, merged, reset, cleaned, stashed, or switched.

## Files changed for Task 06.3L

- `.github/workflows/deploy-production.yml` — early fail-closed workflow steps in build and deploy jobs pending approved whole-release provenance policy.
- `infrastructure/production/deploy-release.sh` — removed execution of the extracted bundle's Python environment/model verifier as root; preparation through the fixed host helper occurs before later activation commands.
- `infrastructure/production/prepare-release-bundle.py` — unconditional provenance hold at the host prepare entrypoint and preparation function; owner-only file mode policy.
- `infrastructure/production/prepare-release-bundle.test.py` — archive-mode matrix and mocked fixed-helper CLI rejection test.
- `infrastructure/production/host-command-policy.test.cjs` — workflow/host ordering, no bundle verifier execution, and retained AI workflow gate policy assertions. Updated one command assertion to match the fixed helper variable invocation.
- `docs/09_Deployment/TASK_06.3L_RELEASE_PROVENANCE_AND_PERMISSION_FIX.md` — remediation and decision report.
- `docs/09_Deployment/TASK_06.3L_IMPLEMENTATION_EVIDENCE.md` — this evidence report.

The infrastructure directory and workflow are part of the pre-existing uncommitted Task 06.3 worktree. This list identifies paths touched for Task 06.3L; it does not imply those paths were newly created in this task. Other existing user changes were not overwritten.

## Checks performed

### Ubuntu WSL2

1. `PYTHONDONTWRITEBYTECODE=1 python3 infrastructure/production/prepare-release-bundle.test.py -v` — **PASS, 25 tests**. This includes the POSIX descriptor/no-follow intake cases, file-mode cases for `0777`, `0755`, `0511`, `0111`, and `0666`, traversal/link/type/size cases, fail-closed helper CLI test, and rollback failure injections.
2. `bash -n infrastructure/production/deploy-release.sh infrastructure/production/install-deploy-command.sh` — **PASS**.
3. `PYTHONDONTWRITEBYTECODE=1 python3 infrastructure/production/production-ai-release.test.py -v` — **PASS, 6 tests**.
4. `PYTHONDONTWRITEBYTECODE=1 python3 infrastructure/production/verify-production-env.test.py -v` — **PASS, 9 tests**.
5. `PYTHONPYCACHEPREFIX=/tmp/electrohub-task063l-pycache python3 -m py_compile infrastructure/production/prepare-release-bundle.py infrastructure/production/prepare-release-bundle.test.py` — **PASS**.

The WSL launcher initially returned `Wsl/E_ACCESSDENIED` under the default sandbox. The same already-authorized local test commands were rerun using the approved elevated local execution path and completed. An earlier compound command with incorrect nested quoting failed before its remaining checks; the checks were rerun as separate valid commands. No software was installed and no host settings were changed.

### Repository-local checks

1. `node --test --test-reporter=dot infrastructure/production/*.test.cjs infrastructure/production/tls/*.test.cjs` — **PASS, 18 tests**.
2. `node .github/scripts/check-workflow-policy.cjs` — **PASS** (`Workflow migration-safety policy: OK`).
3. `node -e "const fs=require('node:fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('.github/workflows/deploy-production.yml','utf8')); console.log('Workflow YAML parse: OK')"` — **PASS**.
4. `git diff --check` — **PASS**. Git displayed existing LF-to-CRLF working-copy warnings for `.dockerignore` and `docs/09_Deployment/NGINX.md`; no whitespace errors were reported.

## Source-level conclusions and limits

- The host helper rejects before it reads trusted intake limits or examines the SSH-user intake. Its mocked CLI test asserts that preparation, checksum verification, extraction, subprocess operations, and pointer mutation are not reached.
- The production workflow stops before build/bundle publication and before deploy-side Docker load/SSH. Static host policy tests assert the host prepare check precedes Docker load and pointer replacement. The fixed helper rejects, so the shell's subsequent commands are unreachable under `set -e`.
- No bundle-supplied Python verifier is invoked by the deployment shell. No actual Bash deployment entrypoint was run against a synthetic host; Bash was syntax-checked only. No Docker daemon, Nginx, browser, real host, database, provider, public endpoint, or production service was contacted.
- The previous root execution of archived environment and AI verifiers was removed. Fixed host-owned equivalents have not yet replaced those checks. The global release hold prevents activation; the follow-up provenance implementation must restore production environment and host-pinned AI validation in fixed host code before any hold can be removed.
- No valid provenance format or trusted identity was selected. Tests for signature/attestation validity, tampering, repository/workflow/source/release claims, issuer, expiry, and replay are **NOT RUN / BLOCKED** because those semantics cannot be implemented without the owner-approved trust contract. The current tests prove rejection by a global hold, not selective provenance verification.
- The AI production metadata gate remains represented in workflow and verifier tests, but the global provenance hold prevents reaching it. Host-side production AI approval is not claimed as runtime-verified or usable until the fixed host preflight is completed under an approved provenance policy.
- Python bytecode compilation used `/tmp/electrohub-task063l-pycache`; test fixtures use disposable temporary directories.
- No workload, cold-start/inference, live TLS, OAuth, external service, or deployment measurement was performed.

## Operations not performed

No cloud resource, host, public certificate, hostname, provider account, artifact store, signing key, trust pin, or production approval manifest was created. No artifacts were uploaded or published. No payment, email, push, or media worker was enabled or dispatched. No migration or database access occurred. No staging, commit, push, merge, deployment, or public exposure occurred.

## Recommended next task

Obtain explicit owner approval for the release signer/workflow identity and host trust-root lifecycle. Then implement the matching workflow attestation and fixed root-owned host verifier with digest/identity/replay/expiry checks and positive/negative tests. Keep the workflow and host intake holds in place until a separate review confirms that provenance is independently verified before extraction or activation.
