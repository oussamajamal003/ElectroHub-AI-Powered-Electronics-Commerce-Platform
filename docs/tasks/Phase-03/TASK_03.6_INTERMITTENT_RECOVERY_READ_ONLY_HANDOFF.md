# Intermittent processing: read-only lifecycle comparison

2026-10-16. **OPEN; no backend recovery closure claimed. Task 03.6 OPEN; NO PUSH.** Prior navigation/mocked acceptance is not real recovery stress evidence.

## Scope and actual evidence

Only the customer already authorized through backend CUSTOMER_CRED was investigated. The DEV connector independently identified project `pzxekjybdiulzmssalfo`. A read-only, five-second-bounded SQL query compared up to three recent paid and three recent noncanceled attempts for that known owner, selecting opaque IDs, state/work metadata and webhook counts only. Stripe GETs checked those exact six intents, verified account `acct_1UEZW5KiVgdl63pN`, Test Mode and each metadata attempt binding. No create, authorize, capture, cancellation, refund, replay or manual state edit was executed.

Provider snapshot: **2026-10-16 13:31:52.212 UTC (16:31:52 Beirut)**.

| Attempt | DEV state / work | Stripe outcome | Other evidence |
| --- | --- | --- | --- |
| `1ec67955-e0cc-43ba-a764-b022428cecac` | AWAITING_INPUT / READY | requires_payment_method, no method, no last error/decline | submitted 13:21:15 UTC; no Order; retries 0; no lease/error |
| `be8cb4cd-41d3-423d-b3a4-c493d3e0b848` | AWAITING_INPUT / READY | requires_payment_method, no method, no last error/decline | submitted 13:17:05 UTC; no Order; retries 0; no lease/error |
| `7f755762-9fea-4931-b2ea-7f6db89f4036` | DECLINED / DONE | requires_payment_method; card_declined / generic_decline | no Order; zero received/capturable |
| `465e39b2-ffa2-4529-9f29-7f857cef02f3` | PAID / DONE | succeeded; received 95900 cents | Order exists |
| `601ab59e-9e45-4e28-b313-4be5bc3ea81c` | PAID / DONE | succeeded; received 59900 cents | Order exists |
| `d44f69f8-3818-4f27-9ed8-dc64da7994d0` | PAID / DONE | succeeded; received 32900 cents | Order exists |

Both awaiting-input intents had received/capturable zero. All six had **zero rows in `stripe_events`**. That is absence of ingested events, not proof that Stripe never attempted delivery. The historical exact browser actions and webhook delivery attempts were not reconstructed. The two earlier owner-authorized cancellations, 080806E3 and BDF8F98A, remain independently verified CANCELED / DONE with cleared leases.

Current Windows process inspection selected Node payment runner/worker/supervisor and Stripe-listen command patterns, emitting only PIDs/types (never command lines). It returned **no matching runner, supervisor or listener**. This is a current local snapshot, not proof of historical process uptime or absence of a separately hosted webhook endpoint. Loopback health checks: port 5000 HTTP200; port 3000 ECONNREFUSED. No service/process was started, killed or restarted.

Sanitized provider receipt: `.cache/payment-lifecycle-followup/intermittent-provider-comparison.json`; fixed-ID GET-only helper `compare-provider-outcomes.cjs`. Authenticated status discovery via localhost frontend failed because port 3000 was unavailable. Its direct-backend helper also encountered a local Fetch API diagnostic error and was not treated as payment-state evidence. Normal owner-requested account sign-in requests may create authentication sessions; no financial-state mutation occurred. Do not conflate diagnostic helper failures with database transaction failures.

## Evidenced operational gap, not a complete historical root-cause claim

The recovery runner is separate from API startup. Signed webhook ingestion schedules work but does not drain it. An explicit frontend confirmation/reconcile can invoke `process`, so an uninterrupted browser journey may settle despite the absence of a continuously running runner. A durable submit followed by navigation/unmount before Stripe confirmation deliberately avoids confirming an unmounted card form. It can therefore leave requires_payment_method/no-method/no-error input work behind. The two queued snapshots are consistent with that path; **their exact interruption point is not independently proven**.

With no current autonomous runner, READY jobs and expired claims cannot advance merely because the customer refreshes a read-only Cart. This is a concrete unattended-recovery gap. None of the two queued intents currently supplies proof of a financial decline, so forcing FAILED would be incorrect. Existing source supports claim recovery, provider readback, safe lapse eligibility and bounded provider retry/incident escalation, but those mechanisms require a running supervised process and monitored escalation delivery.

Source review found `wake` and webhook scheduling already exclude LEASED work; it did not reproduce a new lease-stealing race. No speculative changes were made to financial transactions, capture/compensation decisions or worker fencing. Earlier startup retry/batch isolation/alert-source corrections remain local test evidence, not an assertion that the actual runner is operational.

## Required real acceptance: blocked

No Docker, psql, postgres or pg_ctl command was found in the shell inventory. None of the eight disposable PostgreSQL/Stripe configuration/approval variables was present. No approved throwaway endpoint or per-run TLS CA was available. Existing guarded entrypoints were inspected, not executed:

- `payment-pg-disposable.cjs`: requires proven loopback PostgreSQL17 isolation, fresh per-run short-lived CA and scope-specific authorization before provisioning/testing.
- `payment-stripe-disposable.cjs`: additionally requires exact Test account, allowed operations (create/authorize/capture/cancel/refund) and an explicit run allowance. It must not inherit shared DEV database credentials.

**New real acceptance dispatches: 0. Stress attempts: 0.** The six existing real attempts above are read-only comparisons, not six new tests. No temporary database failure, live delayed/out-of-order webhook, concurrent capture, restart or browser-close financial acceptance was performed. No CI/migration command, PROD access, commit, staging, push or deployment occurred.

The smallest next owner action is to provide/provision the approved disposable PostgreSQL17 runtime with its per-run CA, and authorize the exact Test account/operation set/run allowance for the guarded suite. Configure supervision and alert delivery in that isolated runtime, then run repeated success/decline/interruption/concurrency and failure-injection acceptance, retaining counts and provider/database receipts. Any shared DEV runner activation or repair of the two new attempts needs its own explicit scope; do not reuse the earlier single-purchase cancellation approvals or launch a global worker as a shortcut.

The navigation correction has passing browser evidence, documented separately. The intermittent autonomous backend recovery defect **must remain OPEN** until the operational gap is corrected and repeated real-backend verification passes.
