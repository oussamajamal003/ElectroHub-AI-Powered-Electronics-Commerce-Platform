# Task 06.3M — Release Provenance Trust-Owner Decision

**Review date:** 2026-11-19
**Status:** **READY FOR OWNER APPROVAL** — proposed trust contract only; no owner decision has been recorded.
**Production release:** **NO-GO — fail-closed hold remains active.**
**Scope:** Trust design, ownership and release-governance proposal. No signing, attestation, verifier, host trust-root or release activation was implemented.

## 1. Executive recommendation

Adopt, subject to explicit owner approval, **GitHub artifact attestations backed by GitHub Actions OIDC and Sigstore**, with a fixed, root-owned host verifier that can verify an attestation bundle offline against separately enrolled, current Sigstore trusted-root material. Attest the SHA-256 digest of one deterministic archive containing the complete application release payload. Have the host independently verify the attestation subject and identity policy before extraction or any bundle-derived action. Preserve the internal release manifest checks as byte-integrity checks after provenance succeeds.

For isolation, the proposed signer should be a dedicated reusable production release-builder workflow, reviewed and pinned to a full workflow commit SHA. The current deployment workflow may remain the caller and deployment coordinator. It must keep exact source SHA checks, protected-ref/environment controls, and minimum permissions. The exact immutable repository ID, workflow path/revision, environment rules, trust-root custodian, root enrollment method, freshness and recovery policy are **pending owner approval**. The proposed reusable workflow file does not currently exist, and the existing workflow has no attestation step or `id-token: write` permission.

This approach avoids a long-lived signing private key and suits a single VPS better than creating a separate key-management system. It still depends on GitHub Actions, GitHub's OIDC issuer, Sigstore verification material, and (for this public repository) the Sigstore public transparency log. Offline verification is documented, but a stale imported trust root cannot reveal later revocations. The host must fail closed when trusted-root freshness or verification cannot be established.

This is a recommendation, **not an approval**. No trust owner, signer, account-level workflow protection, trust-root custodian, rotation/revocation process or recovery process is established by this report. Until an authorized owner approves those decisions and a later implementation proves the full verifier path, both the workflow and host intake must remain disabled.

## 2. Current trust boundary and threat model

### Current implementation state

The current repository origin is `https://github.com/oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform.git`. The workflow file is `.github/workflows/deploy-production.yml`.

- The workflow is manual (`workflow_dispatch`) and restricted in YAML to `refs/heads/develop`; it validates that the supplied lowercase full SHA equals `GITHUB_SHA`.
- The build job exits at **“Fail closed pending approved whole-release provenance policy”** before checkout, image build, bundle assembly or upload. The deploy job exits at the same hold before checkout, bundle download, Docker load, SSH setup, transfer or host invocation.
- Workflow permissions are read-only (`contents`, `checks`, `actions`). There is no `id-token: write`, `attestations: write`, or artifact attestation-generation step.
- The fixed host helper `infrastructure/production/prepare-release-bundle.py` calls `_require_approved_release_provenance()` both at the `prepare` entrypoint and inside `prepare_bundle()`. That function unconditionally rejects the request before reading root-managed limits, opening SSH-owned intake, copying files or extracting the archive.
- `infrastructure/production/deploy-release.sh` invokes the fixed helper before Compose validation, Docker image load, release-directory rename, active-pointer replacement or Compose startup. It does not execute the removed bundle-provided environment or AI verifier scripts as root.
- `infrastructure/production/install-deploy-command.sh` installs the helper and deployment command from reviewed repository paths into fixed root-owned locations. No attestation verifier or trust root is currently installed by it.
- `release-manifest.json` hashes its bundle members and can establish internal consistency. It is not signed or authenticated by an independent trust root. The separate AI approval/hash-pin contract does not authenticate the complete application release.

The live implementation therefore remains **fail-closed**. It is safer than accepting an unauthenticated release, but it is not a functional, authenticated release pipeline. Do not remove either hold until the host can authenticate the complete payload with independently maintained trust material and the end-to-end rejection tests pass.

### Threats the contract must address

1. An SSH intake writer replaces the archive, its manifest, approval JSON, Compose file, image archive, or all of them with a self-consistent malicious bundle.
2. A malicious or compromised bundle attempts to cause privileged extraction writes, execute verifier code, load an image, replace the release pointer or start services before trust checks complete.
3. An unrelated GitHub repository, workflow, branch, environment, runner or signer produces a valid but unauthorized attestation.
4. A repository/workflow rename, transfer, workflow revision change, OIDC identity change, or trust-root rotation makes a name-only policy ambiguous or stale.
5. A valid release is replayed after it has already been consumed, or a previously approved digest is replayed for a different environment or deployment authorization.
6. A build workflow is compromised and creates a valid signature over attacker-selected content or a misleading predicate. Attestation cannot prove that a trusted workflow's claims are truthful if the workflow itself is compromised.
7. The verifier, trust root, clock, transparency-log proof, or required online dependency is unavailable or stale at deployment time.
8. A valid application provenance statement is incorrectly treated as approval of AI quality, model source, redistribution rights, vector-index state or production activation.

This policy does not protect a VPS after root compromise or prove upstream dependencies benign. Those remain separate host and software-supply-chain risks.

## 3. Provenance option comparison

| Criterion | GitHub artifact attestations / Sigstore OIDC | Dedicated signing key + signed envelope |
|---|---|---|
| **What is authenticated** | The signed attestation binds an artifact subject digest to GitHub workflow/OIDC identity and build-provenance claims. Host policy must constrain the signer and validate all required claims. The signature says which workflow identity attested the subject; it does not certify that code or model is safe. | The envelope proves that the holder of a configured private key signed the payload digest and declared fields. Repository/workflow identity is only as strong as the key-access controls and signed statement; a key signature alone does not prove GitHub built the bundle. |
| **Exact identity policy** | Can constrain issuer, repository, signer workflow, source ref and source digest with the GitHub CLI; the verifier must additionally compare the immutable repository ID from verified certificate data to a root-managed expected ID. Validate the exact reusable signer workflow and workflow revision. Do not rely on repository name alone for offline bundles. | Pin one or more public keys and explicitly bind the intended repo, workflow path/revision, ref, environment and source SHA in the signed envelope. These claims are meaningful only if the private key is available exclusively to the approved workflow or signer process. |
| **Host online/offline behavior** | GitHub documents offline verification using a local artifact, bundle, GitHub CLI and `trusted_root.jsonl`. That permits no GitHub API call during deployment, but depends on a separately refreshed root. Online verification can fetch attestations and current trust material, but introduces GitHub/Sigstore network and availability dependencies. | Straightforward offline verification with the host-pinned public key and a signed envelope. Does not inherently need GitHub, an API, or an external verifier service. |
| **Transparency log** | Public repositories use the Sigstore Public Good Instance; the bundle carries signature/certificate and transparency evidence. Public transparency improves auditability, but reveals metadata associated with public builds. The host verifier must validate the proof and timestamp. | No transparency log is required. A separate audit ledger or signed release registry would be needed for independent visibility and discovery; those are not currently approved. |
| **Key custody** | No persistent signing private key is held in repository secrets or on the VPS. GitHub OIDC obtains a short-lived identity/certificate for the authorized workflow. Trust-root data and verifier versions still require secure maintenance. | A long-lived private key, HSM or KMS identity needs an accountable owner, protected custody, backup, access policy and operational recovery. A key in a CI secret creates an exfiltration target. An HSM/KMS could add cost and provider dependency. |
| **Rotation and revocation** | Rotate/refresh Sigstore trusted-root material and update the host's allowed repo/workflow/ref/revision policy. Offline verification cannot learn about revocation after the root snapshot was imported; GitHub documentation warns stale offline roots may continue to verify and do not reveal revoked material. Identity revocation therefore needs a root-managed deny/update process and freshness limit. | Publish and enroll a new public key, allow an explicitly bounded overlap, then remove/revoke the old key on every host. A compromised key remains trusted wherever old policy is not updated. Recovery depends on the owner retaining an independently protected root/admin channel. |
| **Replay protection** | Attestation validity alone does not prevent replay. Host must persist consumed deployment request IDs and bind each use to target environment, release digest and operator authorization. | Same requirement; a signed immutable release may be replayed unless the host tracks one-time deployment authorization and use. |
| **One-VPS complexity** | Moderate: a pinned host CLI/verifier, trusted-root lifecycle, strict identity policy and one persistent replay ledger. It uses existing GitHub and avoids introducing a signing-key custody program. | Initial verifier can be small, but secure key custody, rotation, revoke/restore and independent delivery burden are substantial relative to one VPS. Offline verification is simpler only after the key lifecycle is reliable. |
| **Long-term maintenance** | Uses common supply-chain tooling and short-lived identities, but GitHub/Sigstore format, CLI and trust-root changes must be monitored and compatibility-tested. Pin verifier versions and qualify updates before host rollout. | Cryptographic envelope format and verifier can be stable, but the project owns its key lifecycle and auditability indefinitely. Fewer service changes, more human/key-management burden. |
| **Cost/external dependencies** | No new paid registry or signing account is proposed. It depends on GitHub Actions and Sigstore. Actions compute/storage remain subject to the repository's plan and usage. Public-repository attestations use public transparency infrastructure. No account billing, Actions quota or feature entitlement was checked here. | Offline signing/verification can avoid a separate service cost if suitable keys and operator processes already exist; none are established. A managed HSM/KMS or hosted key service may cost money and requires separate approval. Manual custody has staff/time and recovery costs. |
| **Assessment** | Best fit **conditionally** for the current public GitHub repository and single VPS, if the project approves the workflow identity, immutable repository ID, trust-root owner and root-refresh/revocation procedure. | Viable fallback if the project will not depend on GitHub/Sigstore, but requires explicit ownership, secure private-key custody and a tested out-of-band key lifecycle. Not selected. |

### Recommendation and limitations

Prefer GitHub artifact attestations using GitHub OIDC and Sigstore, not an ad hoc checksum signature. Use a dedicated reusable trusted-builder workflow, exact certificate/issuer constraints, repository ID verification, subject digest checks, and a separately managed host trust root. The public-repository mode uses a public transparency log; this is a security and metadata-disclosure tradeoff that the owner must accept.

Offline operation is appropriate for a one-VPS deployment only if the operator can securely keep the root fresh. A stale root can continue to accept signatures and may miss revoked trust material. Proposed policy: the host accepts an imported trusted-root snapshot only if its separately recorded refresh date is no more than **30 days** old; refresh through independently authenticated TUF/Sigstore material, never through the release bundle. Thirty days is a proposed policy value, not a provider guarantee or an approved setting. If root freshness cannot be established, the host rejects the release. A later online-verification design may replace this only after network, API-authentication and outage behavior are tested and approved.

## 4. Proposed trust contract — pending owner approval

The host must receive a deterministic `release-payload.tar` plus an attestation bundle as separate files. The payload archive must contain all files whose integrity affects deployment: source archive, image archive, application release manifest, AI release and model-approval metadata, and deployment Compose/config inputs. The attestation bundle is **not included in the payload subject** (avoiding a circular digest); its signed subject is the SHA-256 of the complete payload archive. The internal manifest remains a secondary per-file consistency check.

The proposed logical provenance record is below. Its values and the actual attestation schema require owner approval and conformance tests; do not treat this example as an implementation format or an approval document.

```json
{
  "repository": {
    "host": "github.com",
    "owner": "oussamajamal003",
    "name": "ElectroHub-AI-Powered-Electronics-Commerce-Platform",
    "immutableRepositoryId": "PENDING_OWNER_VERIFICATION"
  },
  "signer": {
    "oidcIssuer": "https://token.actions.githubusercontent.com",
    "callerWorkflowPath": ".github/workflows/deploy-production.yml",
    "callerRef": "refs/heads/develop",
    "signerWorkflowPath": ".github/workflows/reusable-production-release.yml",
    "signerWorkflowRef": "refs/heads/develop",
    "signerWorkflowSha": "PENDING_REVIEWED_FULL_SHA",
    "environment": "electrohub-production-deploy",
    "runnerEnvironment": "github-hosted"
  },
  "source": {
    "commitSha": "<40-character lowercase SHA>",
    "ref": "refs/heads/develop"
  },
  "subject": {
    "name": "electrohub-production-payload.tar",
    "digest": { "sha256": "<64 lowercase hexadecimal characters>" }
  },
  "invocation": {
    "workflowRunId": "<GitHub run ID>",
    "workflowRunAttempt": "<positive integer>"
  },
  "release": {
    "releaseId": "eh-prod/<repo-id>/<source-sha>/<run-id>/<attempt>/<payload-sha256>",
    "intendedEnvironment": "production"
  }
}
```

**The proposed signer path is not present today.** `.github/workflows/reusable-production-release.yml` is a candidate name for a future reviewed reusable builder, not a current workflow or approved identity. The current caller path exists, and its production jobs currently stop at the fail-closed hold. `electrohub-production-deploy` exists in workflow YAML; its actual Environment reviewers, deployment branch rules and account protection were not inspected and are not proven by YAML.

| Claim | Host-side acceptance rule |
|---|---|
| Repository | Require the canonical GitHub host and name, plus the immutable numeric repository ID independently enrolled in root-owned policy. For offline bundles, compare the verified certificate's source repository identifier with that constant; the GitHub CLI docs warn the name check alone cannot detect a renamed/reused name. The numeric ID is **not established in this task**. |
| Issuer/signer | Require `https://token.actions.githubusercontent.com` and the exact allowed signer workflow identity/path. Reject wildcard identity matching and unapproved reusable workflows. Verify the certificate, signature, timestamp and transparency proof using the approved trusted root. |
| Protected ref/environment | Require the approved `develop` ref and the owner-approved protected production Environment claim. The host must validate a protected-ref/environment claim exposed in authenticated certificate/verification output, not merely trust a caller-supplied field. Require external account settings to enforce protections; a YAML `environment:` key alone does not prove approval reviewers or branch rules. |
| Workflow revision | Require the exact approved reusable workflow identity and a permitted reviewed workflow revision/digest. Do not accept an arbitrary workflow file with the same display name. Any signer path or workflow SHA change is an owner-approved trust-policy change. |
| Source commit | Require exactly 40 lowercase hex characters and equality among the release input, the exact source commit used to create the source archive/images, and the attestation's verified source digest. Require the approved ref. The current workflow's `approved_commit == GITHUB_SHA` check is useful input validation but not a provenance signature. |
| Complete release bytes | Compute SHA-256 of the received payload archive from the root-controlled copy and require an exact match with the verified attestation subject digest **before extraction**. Then validate the internal manifest and every member digest against the authenticated payload. |
| Run and attempt | Require a positive run ID and attempt bound to the signer invocation. Validate immutable OIDC/certificate data where exposed; if a required run/attempt value exists only in a statement predicate, accept it only from the isolated trusted builder and verify it against authoritative GitHub run metadata or another approved authenticated claim. Do not trust raw JSON fields solely because they are present. |
| Release/target identity | Require a canonical unique release ID derived from repository ID, source SHA, workflow run ID, run attempt and payload digest; require target `production`. Reject a mismatch between requested target, signed identity and root-managed host policy. |
| AI metadata | Independently validate the separate host-pinned AI production approval, manifest digest and compatibility contract using fixed root-owned code. Application provenance does not satisfy that gate. |

GitHub's offline verifier can compare the attestation to a repository name, verify an exact signer workflow, and accept a local bundle/trusted root. GitHub also documents that offline verification against names alone cannot establish current repository identity after rename/reuse and instructs consumers to compare the immutable repository ID from verified certificate data with an independently obtained ID. The host policy must perform that comparison and test the exact output format before deployment integration.

### Expiry, replay and failure behavior

- **Attestation signing time:** require a verifiable Sigstore signed timestamp within the signing certificate's validity interval, and verify transparency-log inclusion. Do not treat a certificate that has expired now as invalid if its authenticated signing time was valid under the verifier's documented policy. Do not accept an unsigned local timestamp as a substitute.
- **Deployment authorization expiry:** require a separate one-time production deployment authorization bound to the exact `releaseId`, payload digest and `production` target. Proposed validity window: **24 hours** from authorized issuance with at most **5 minutes** clock skew. These are proposed operational values and remain owner decisions. Rollback/redeployment of the same immutable payload requires a new explicit deployment authorization; it must not replay an already consumed authorization.
- **Replay ledger:** fixed host code records each consumed deployment-request ID, release ID, digest, environment and outcome in root-controlled persistent state before activation. Reject reused request IDs, a request bound to a different digest/environment, duplicate release IDs without a new authorization, and attempts with non-monotonic/ambiguous run-attempt identity. A failed pre-activation request may only be retried under a documented idempotency rule; a post-pointer-change failure must follow the existing explicit rollback process and must not reuse the rejected bundle as an implicit recovery action.
- **Trusted-root freshness:** proposed maximum import age is 30 days; a stale or unverifiable root is a hard reject. Root version/expiry/freshness must be checked using fixed host policy and recorded independently of release inputs. If the Sigstore TUF root is unavailable for secure refresh, deployment waits; the host does not accept a stale snapshot indefinitely.
- **Malformed or ambiguous evidence:** reject missing/duplicate attestations, malformed JSON/DSSE, duplicate keys, unsupported schema/predicate, multiple conflicting subjects, missing claims, unknown issuer, invalid signature, invalid timestamp/log proof, wrong identity/ref/SHA/digest/target, expired deployment authorization, or replay. No permissive fallback, `--check-claims=false`, unsigned checksum-only mode, or local-candidate exception is allowed.
- **Unavailable verifier/network/clock:** the recommended offline mode removes a deployment-time GitHub API dependency, but still needs the pinned verifier, bundle and sufficiently fresh trusted root. If any are unavailable, invalid or stale, reject before extraction, bundle code, Docker load, pointer mutation or Compose startup. No deployment-side “AI unavailable” bypass is implied. The current global release hold remains in force.
- **Execution order:** root-controlled bounded intake copy → fixed verifier authenticates complete raw payload digest and claims → internal manifest/file/archive validation using fixed host code → production environment and independent host-pinned AI approval checks → Compose config/policy validation → Docker image load and image digest verification → immutable release directory and pointer switch → Compose startup/readiness. Any failed step before pointer mutation has zero activation effects. No code from the bundle is executed as a root verifier.

## 5. Trust-root ownership and lifecycle proposal

| Lifecycle concern | Proposed control (all pending approval) |
|---|---|
| Provenance policy owner | A project-designated infrastructure/security policy owner is accountable for the repository ID, approved issuer/workflow/ref/environment, allowed workflow revisions, verifier version, freshness and revocation policy. No named owner or role assignment was found; the authorized project owner must designate one. |
| Workflow/signer identity changes | Require two-person review by the designated policy owner and release authority for changing repository identity, signer workflow path/revision, protected ref, Environment, issuer or verifier. Changes are reviewed as a policy change, tested with positive/negative vectors, and enrolled before the workflow can release. No trust update may be bundled with the release it authorizes. |
| Host trust-root custodian | A named operator role must own Sigstore trusted-root refresh, independent verification and root-controlled host installation. The candidate host path is a root-owned file under `/etc/electrohub/`; exact path/mode and custodian need approval. The verifier binary/version and policy file are also installed as host bootstrap material, not from an incoming bundle. |
| Independent enrollment | First enrollment and every root/policy update use an independently authenticated operator channel such as an explicitly approved host-console/bootstrap procedure. Verify upstream TUF/Sigstore metadata and release verifier checksums through trusted documentation/source; record version, digest, source, reviewer and date. Never copy a trust root from the SSH intake or payload archive. No host or cloud resource was accessed in this task. |
| Rotation | Use TUF-protected Sigstore material as supported by the chosen verifier. Pre-stage and verify a new root through the out-of-band channel; maintain a brief, owner-approved overlap only if both roots are valid; switch host policy atomically; remove old trust when its retirement window closes; record all versions and affected hosts. Any pinned workflow identity change is a separate reviewed policy update. |
| Revocation | On suspected signer/repository/workflow compromise, immediately preserve the global hold, revoke the workflow's ability to attest through GitHub controls, update the host policy denylist and trusted-root material out of band, and reject attestations signed under the suspect identity according to owner-approved time/incident policy. Offline hosts cannot discover a later revocation by themselves; root refresh freshness and operator alerts are mandatory. |
| Emergency recovery | Suspend new releases; use the independently authenticated host-console/bootstrap channel to install a reviewed recovery policy/root/verifier; rotate/restrict GitHub Actions and SSH deployment credentials through their owners; audit last accepted digests and release receipts; restore only a previously approved immutable release with a fresh deployment authorization. If host root or trust material is compromised, treat the host as untrusted and require an owner-approved rebuild/re-enrollment decision. Exact responders and recovery time objectives are not set here. |
| Production release approval | A provenance-valid release still requires explicit production release/deployment approval and backup evidence. The release authority must review the exact source SHA, digest, checks, backup evidence and deployment plan. GitHub Environment approval, workflow inputs, and host authorization-reference checking must be verified end-to-end; YAML alone is not proof of account protection. |

No person is named in this decision. The owner approval record below must be completed by the authorized operator before implementation is authorized.

## 6. Application provenance is separate from AI approval

Application provenance answers: **which approved workflow identity attested to these exact application release bytes, from which source commit and execution context?** It does not answer whether the AI model is legally distributable, sufficiently accurate, compatible with a production vector index, or approved for activation.

The following remain independent gates and are not changed by a valid application attestation:

- Task 06.3F records no canonical hosted-CI source for the current AI artifact candidate, unresolved redistribution rights, and no production-quality approval for D3. The recorded Benchmark 5 result for stocked-image rejection was 7/103 (6.8%) against the existing maximum 5%; the shared-DEV exception was limited to DEV and was not production authorization.
- The AI candidate remains `LOCAL_ARTIFACT_CANDIDATE_NOT_PRODUCTION_RELEASE`. Do not relabel it or infer its release status from a valid application bundle signature.
- A future host verifier must separately pin and check the approved AI production release manifest and artifact digest with fixed host-owned code, verify model/embedding/preprocessing/relevance compatibility, and keep artifact installation, model activation and vector-index activation separate.
- AI unavailability must not break commerce, but no unapproved deployment bypass may start the local candidate or skip the global release hold.

AI source, rights, quality, index readiness and activation require their own documented approvals. This task grants none of them.

## 7. Owner decisions and approval record

**Decision state for every item below: PENDING. No approval is inferred from prior conditional architecture reports.**

| # | Authorized owner decision required | Current record |
|---:|---|---|
| 1 | Approve or reject GitHub artifact attestations/Sigstore OIDC as the whole-release provenance mechanism. If rejected, decide whether to authorize a dedicated key model and its custody budget/process. | Pending — not approved |
| 2 | Designate the accountable provenance-policy owner and the role(s) allowed to approve identity/policy changes. | Pending — no owner designated in repository evidence |
| 3 | Confirm canonical repository identity, numeric immutable repository ID, owner ID if needed, and GitHub host; confirm how renames/transfers affect policy. | Pending — slug observed from local Git origin; numeric ID not verified |
| 4 | Approve the signer workflow design and exact path/revision. Proposed caller: `.github/workflows/deploy-production.yml`; proposed trusted signer: `.github/workflows/reusable-production-release.yml` pinned to a reviewed full SHA. Confirm whether this new reusable workflow is acceptable. | Pending — signer file does not exist; current workflow is fail-closed |
| 5 | Confirm the protected ref and production Environment name, required reviewers/rules, runner type, and whether environment approval is required before provenance is generated as well as before deployment. | Pending — YAML declares `develop` and `electrohub-production-deploy`; account-level controls unverified |
| 6 | Assign the host trusted-root custodian and approve the independent enrollment/update channel, verifier installation source, root freshness limit and alerts. | Pending — no trust root/verifier installed |
| 7 | Approve rotation overlap, revocation timeline, incident response, emergency recovery authority and offline/stale-root behavior. | Pending — lifecycle not approved |
| 8 | Approve release/deployment authorization owner, unique one-time authorization format, 24-hour/5-minute proposed expiry/skew, replay ledger retention/backup, and re-deploy/rollback behavior. | Pending — values are proposals only |
| 9 | Confirm application release provenance approval is distinct from AI source, redistribution rights, quality, index readiness and activation approvals. | Pending — separation is required; AI gates remain unresolved |
| 10 | Confirm whether public Sigstore transparency metadata for this public repository is acceptable, and acknowledge public exposure of repository/workflow/build metadata. | Pending — no explicit decision recorded |

### Owner approval record — leave blank until signed by the authorized owner

- Decision: `PENDING`
- Approved design: `PENDING`
- Provenance-policy owner role: `PENDING`
- Host trust-root custodian role: `PENDING`
- Approved repository ID: `PENDING`
- Approved caller/signer workflow identities and protected ref/environment: `PENDING`
- Approved root enrollment, freshness, rotation, revocation and recovery policy: `PENDING`
- Approved deployment authorization expiry/replay policy: `PENDING`
- Approver name/role: `PENDING`
- Approval reference and date: `PENDING`

## 8. Implementation prerequisites and focused acceptance plan

Implementation may begin only after the trust contract is explicitly approved and the owner decisions above are resolved. The implementation task must:

1. Confirm the repository's immutable numeric ID and current OIDC/attestation claim format using authoritative GitHub data; confirm protected branch and Environment settings in account configuration. Record the review source/date. Do not infer these from local YAML.
2. Add a dedicated trusted builder workflow with least-privilege OIDC/attestation permissions, a reviewed full-SHA reusable workflow reference, protected ref and production Environment controls. Do not add long-lived signing keys unless the owner chooses the dedicated-key option.
3. Produce a deterministic complete payload archive and attestation over its SHA-256 subject digest. Include source SHA, bundle digest, unique release ID, run ID/attempt, intended environment, repository/workflow identity and a clear build-vs-package provenance description.
4. Install a pinned fixed verifier and root-managed trust policy outside the release bundle. Enroll/refresh trusted roots independently and fail closed on stale roots. Add a strict parser that rejects ambiguous, duplicate, malformed, unsupported or conflicting evidence.
5. Authenticate the raw payload before extraction or any bundle-derived code use; then validate internal checksums, bounded archive paths/types/sizes, environment, image identities and the separate host-pinned AI release approval before Docker load, pointer changes or Compose.
6. Add a root-managed replay ledger and one-time deployment-authorization binding. Specify how a successful deploy, pre-activation rejection, post-pointer failure, rollback and authorized redeploy update the ledger without causing an implicit restart of a rejected release.
7. Keep all candidate and AI release approval gates distinct. Do not fabricate production AI metadata, use the local candidate, activate a model, or alter a vector index under this app provenance decision.

Focused disposable test matrix:

- Valid attestation/bundle for the exact approved repository ID, signer workflow/revision, issuer, ref/environment, source SHA, payload digest, run/attempt, release ID and target is accepted.
- Reject missing/malformed/duplicate attestations; invalid signature, timestamp or transparency proof; wrong issuer, repository ID/name, signer path/revision, ref/environment, source SHA, payload digest, run/attempt, release ID or deployment target; unknown predicate; conflicting statements; expired authorization; stale root; replayed deployment request; and verifier/network/root unavailable cases.
- Tamper each payload member after attestation generation and prove rejection before extraction, bundle code execution, Docker load, pointer mutation or Compose invocation.
- Prove the attestation and trusted root cannot be replaced by the SSH intake, payload, manifest, workflow artifact, image archive or any other bundle input.
- Inject pointer, ledger and Compose failures; prove no rejected candidate is started and preserve original deployment error context.
- Confirm fixed host-owned environment and AI production approval checks run after bundle authenticity but before Docker load, and continue to reject the local-only AI candidate.
- Confirm exact workflow permissions/pins, protected Environment behavior, source lineage validation, immutable payload naming, rollback receipt and audit trail.

No such implementation or tests were run for Task 06.3M. The existing fail-closed tests and Task 06.3L evidence remain the only local evidence for current rejection behavior.

## 9. Remaining unknowns

| Unknown | Why it matters | Resolution evidence |
|---|---|---|
| Immutable GitHub repository ID and owner ID | Prevents name reuse/rename ambiguity in offline verification. | Owner-confirmed GitHub metadata; record numeric ID in separately enrolled host policy. |
| Protected branch/Environment settings and actual reviewers | YAML shows intent but not enforcement. | Read-only owner/admin review of GitHub settings and a disposable protected-environment workflow exercise. |
| Exact attestation claim shape for repo ID, environment, run/attempt, source digest and reusable-workflow identity | Host must distinguish signed immutable certificate claims from workflow-controlled predicate data. | Generate an approved non-production test attestation after owner approval; inspect verifier JSON and test each claim with forged predicate fixtures. Do not create production attestation in this task. |
| Trusted-root refresh/revocation and offline freshness | Stale roots may miss later revocations. | Owner-approved freshness window, refresh process, independent bootstrap channel, outage/fail-closed runbook and revocation drill. |
| Secure host verifier installation/version and key/root storage | A compromised or bundle-selected verifier defeats provenance checks. | Fixed root-owned verifier installed through reviewed host bootstrap, pinned digest, independent update and rollback process. |
| One-time deployment approval and durable anti-replay state | A valid provenance statement alone does not authorize deployment or prevent replay. | Owner-approved authorization/ledger schema, persistence/backup and failure-injection test. |
| AI canonical artifact source, rights and D3 production quality | App provenance cannot close AI-specific release blockers. | Separate Task 06.3F/AI owner decisions and qualifying model-quality evidence. |

## 10. Public documentation consulted

Access date: **2026-11-19**. These sources establish documented product behavior only; they do not establish ElectroHub's account settings, enabled features, repository ID, billing status, or production protection configuration.

- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) — provenance fields; public repositories use Sigstore Public Good Instance and a publicly readable transparency log; attestations must be verified and do not guarantee artifact security.
- [GitHub: verify attestations offline](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline) — local bundle/trusted-root flow; offline repository-name caveat and explicit repository-ID comparison; stale trusted-root revocation limitation.
- [GitHub CLI: `gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify) — issuer, signer workflow, source ref/digest, bundle and custom-trusted-root options; verified statement predicate data may be workflow-controlled.
- [GitHub CLI: `gh attestation trusted-root`](https://cli.github.com/manual/gh_attestation_trusted-root) — trusted-root export and TUF options.
- [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc) — issuer, repository ID, run ID/attempt, workflow/ref, environment and available claim concepts.
- [GitHub: attestations with reusable workflows](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating) — exact signer-workflow constraint and reusable trusted-builder pattern.
- [Sigstore: verify Cosign signatures](https://docs.sigstore.dev/cosign/verifying/verify/) and [sign blobs](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/) — identity-based verification, bundle contents, timestamps and transparency inclusion.
- [Sigstore custom components and trusted roots](https://docs.sigstore.dev/cosign/system_config/custom_components/) — trust-root/TUF distribution and update material.

## 11. Decision

**Task 06.3M disposition: READY FOR OWNER APPROVAL.** The conditional recommendation and owner decisions are concrete enough for an authorized project owner to approve or reject. This disposition is not approval of the trust contract and does not authorize implementation, release, staging, deployment, spending, or production activity.

**Current deployment state remains NO-GO.** Keep both fail-closed workflow steps and the host helper rejection intact until explicit approval, implementation of the fixed host trust boundary, source-level security review, and focused positive/negative Linux verification are complete. A subsequent independent pre-commit audit remains required before any commit decision.
