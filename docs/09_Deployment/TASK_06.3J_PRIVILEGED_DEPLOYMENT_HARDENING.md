# Task 06.3J — Privileged Deployment Hardening

**Decision:** **READY FOR FINAL PRE-COMMIT AUDIT**
**Production deployment:** **NO-GO**
**Scope:** Repository implementation and disposable local checks only.

## Summary

This change addresses the two Task 06.3I blockers in the privileged deployment path. The host now treats the SSH upload area as untrusted input, copies the bundle into a private root-owned stage using pinned file descriptors, bounds and validates the source archive before extraction, and uses a fixed installed host verifier for bundle hashes and loaded image identity. Rollback checks pointer creation, replacement and resolution before it can start the previous Compose release.

The production AI approval identity and host trust-pin checks remain required. The local AI candidate remains ineligible for production. No deployment, purchase or external operation was authorized or performed.

## A1 — Intake, archive and bundle integrity

### Root-controlled handoff

- The host helper is installed separately at `/usr/local/libexec/electrohub-prepare-release-bundle.py` as a root-owned, non-writable file. The reviewed installer refuses to replace differing host files.
- The helper requires a root-controlled path through `/var/lib/electrohub`, then opens the SSH-user-owned `incoming` directory and exact-SHA child without following symlinks. The incoming root and child must not be group- or world-writable; the child owner must match the intake owner.
- It opens each of the five expected inputs relative to the pinned child-directory descriptor with `O_NOFOLLOW` and `O_NONBLOCK`, checks the opened descriptor is a single-link regular file, enforces a byte cap, and copies from that descriptor. A check-then-open `test -f` is not used as a trust boundary.
- Copy destinations use exclusive, no-follow creation in a root-owned mode `0700` staging directory. Files remain mode `0600`; extracted source files are private and do not preserve group/world permissions. Cleanup is limited to the exact task-owned staging-name pattern and walks directories without following links.

### Archive validation and limits

Limits are read only from the root-managed `/etc/electrohub/compose.env`; the deployment script no longer accepts an environment override for that config path. Bundle metadata cannot change the limits. Missing, malformed, zero, or over-ceiling settings fail closed.

| Setting | Example cap | Helper hard ceiling |
|---|---:|---:|
| Compressed `source.tar.gz` | 512 MiB | 2 GiB |
| `images.tar` input size | 8 GiB | 16 GiB |
| Source member count | 50,000 | 100,000 |
| Individual expanded source file | 256 MiB | 1 GiB |
| Aggregate expanded source file bytes | 2 GiB | 8 GiB |

The gzip stream also has a derived cap for tar headers, padding and bounded PAX metadata. PAX headers are limited to 64 KiB each; paths are limited to 4 KiB total and 255 UTF-8 bytes per component. These are explicit safety limits, not measured bundle requirements. The 8 GiB image cap does not establish Docker layer expansion or host disk capacity.

The helper parses and validates archive metadata before extraction. It rejects absolute paths, traversal, non-canonical or conflicting paths, duplicates, links, devices, FIFOs, sparse and other unsupported member types. Extraction is manual, uses descriptor-relative no-follow directory opens and exclusive file creation, and does not call `extractall`.

The fixed host verifier validates the exact-SHA release manifest and streams SHA-256 checks over all four manifest-addressed bundle files before source extraction or execution of bundle-provided verifiers. The host repeats file verification before image load, then verifies loaded image IDs through the fixed helper. The deployment script no longer executes the bundle-provided `verify-release-bundle.py` as root.

The GitHub deploy job now runs `verify-release-manifest.cjs --files-only` before runner-side `docker load`; it performs loaded image identity verification afterward. The files-only verifier hashes files in bounded memory and rejects symlinks where the host supports no-follow opens.

Checksums establish bundle integrity relative to the supplied manifest; they do not provide a cryptographic signature or independent source authenticity. The protected workflow, exact-SHA approval and SSH credential remain part of the external trust boundary. No signing or attestation mechanism was added here.

### Activation ordering

Host order is now: safe intake and bounded extraction; fixed host manifest/file verification; production environment and AI approval checks; fixed host file re-verification; Compose config validation; Docker image load; fixed host loaded-image check; release directory move; current-pointer replacement; Compose startup and health checks. A rejected intake or manifest exits before Docker load, release-pointer mutation or service startup.

## A2 — Rollback failure handling

Rollback is delegated to the installed host helper. It creates a unique temporary symlink, checks creation and atomic replacement, then resolves `current` and requires it to equal the explicit immutable previous-release directory. Only after that verification does it build a Compose argument list using the previous release’s explicit `production.compose.env` and Compose file paths.

If link creation, replacement or verification fails, the helper emits a critical operator message and does not invoke Compose. It never retries through `current`. The shell trap disables its own `ERR` recursion, records the original failure line and status, reports rollback failure separately, and exits with the original deployment status. If Compose recovery itself fails, that is also logged as critical while the deployment remains unsuccessful.

## Verification and limitations

- The focused host-guard suite exercises compressed/member/file/aggregate limits, malicious archive paths and member types, duplicate/conflicting paths, manifest/hash rejection, and rollback failure injection.
- POSIX `openat`/`O_NOFOLLOW`, FIFO/socket and extraction tests are included and wired into CI, but were skipped on this Windows workstation. No remote CI result is claimed.
- A locally generated `git archive` of the current `HEAD` passed the metadata scanner: 3,153 members, 72,899,235 compressed bytes. This is a format compatibility check of the current committed baseline, not a production release bundle measurement, and it did not perform extraction.
- Bash syntax/runtime verification was unavailable: launching `bash -n` returned Windows `Bash/E_ACCESSDENIED`. `shellcheck` and `shfmt` were not available. Docker, Compose, Nginx and a Linux host runtime were not used.
- The selected example limits still require comparison with an actual approved bundle and the eventual host’s disk and Docker storage budget. No capacity measurement was performed.

## Remaining release gates

This task does not establish public hostname/OAuth eligibility, public TLS lifecycle, browser session compatibility, backup/restore, account-level GitHub Environment protections, host SSH/sudo policy, production artifact rights/source/quality approval, full-stack host capacity, or runtime health. Those gates remain open. The deployment status remains **NO-GO**.

The next repository step is an independent final pre-commit audit, including Linux execution of the POSIX intake tests and Bash syntax validation. That audit is not commit or deployment authorization.
