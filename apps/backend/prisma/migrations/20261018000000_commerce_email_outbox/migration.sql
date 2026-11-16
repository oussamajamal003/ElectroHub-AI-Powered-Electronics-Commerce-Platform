BEGIN;

-- Task 03.8: commerce email outbox and send-attempt journal. Additive only: no existing table, enum or row is altered.

-- CreateEnum
CREATE TYPE "CommerceEmailType" AS ENUM ('ORDER_CONFIRMED', 'PAYMENT_CONFIRMED', 'ORDER_PREPARING', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'PAYMENT_REFUNDED');

-- CreateEnum
CREATE TYPE "CommerceEmailDispatchState" AS ENUM ('READY', 'LEASED', 'RETRY_WAIT', 'ACCEPTED', 'UNCERTAIN', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "CommerceEmailDeliveryState" AS ENUM ('UNKNOWN', 'DELIVERED', 'BOUNCED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CommerceEmailAttemptOutcome" AS ENUM ('STARTED', 'ACCEPTED', 'REJECTED', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "commerce_email_outbox" (
    "id" UUID NOT NULL,
    "eventKey" VARCHAR(255) NOT NULL,
    "type" "CommerceEmailType" NOT NULL,
    "orderId" UUID NOT NULL,
    "paymentId" UUID,
    "userId" UUID,
    "transitionId" UUID,
    "fromStatus" VARCHAR(32),
    "toStatus" VARCHAR(32),
    "recipient" VARCHAR(255),
    "snapshot" JSONB,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "templateVersion" VARCHAR(16) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dispatchState" "CommerceEmailDispatchState" NOT NULL DEFAULT 'READY',
    "deliveryState" "CommerceEmailDeliveryState" NOT NULL DEFAULT 'UNKNOWN',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "provider" VARCHAR(16) NOT NULL DEFAULT 'BREVO',
    "providerMessageId" VARCHAR(255),
    "acceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "uncertainAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(64),
    "suppressionReason" VARCHAR(64),
    "payloadPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_email_attempts" (
    "id" UUID NOT NULL,
    "outboxId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "leaseToken" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "outcome" "CommerceEmailAttemptOutcome" NOT NULL DEFAULT 'STARTED',
    "providerMessageId" VARCHAR(255),
    "httpStatus" INTEGER,
    "errorCode" VARCHAR(64),

    CONSTRAINT "commerce_email_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commerce_email_outbox_eventKey_key" ON "commerce_email_outbox"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_email_outbox_providerMessageId_key" ON "commerce_email_outbox"("providerMessageId");

-- CreateIndex
CREATE INDEX "commerce_email_outbox_dispatchState_nextAttemptAt_createdAt_idx" ON "commerce_email_outbox"("dispatchState", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_email_outbox_dispatchState_leaseUntil_idx" ON "commerce_email_outbox"("dispatchState", "leaseUntil");

-- CreateIndex
CREATE INDEX "commerce_email_outbox_orderId_createdAt_idx" ON "commerce_email_outbox"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_email_outbox_paymentId_idx" ON "commerce_email_outbox"("paymentId");

-- CreateIndex
CREATE INDEX "commerce_email_outbox_userId_idx" ON "commerce_email_outbox"("userId");

-- CreateIndex
CREATE INDEX "commerce_email_attempts_outboxId_startedAt_idx" ON "commerce_email_attempts"("outboxId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_email_attempts_outboxId_attemptNumber_key" ON "commerce_email_attempts"("outboxId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_email_attempts" ADD CONSTRAINT "commerce_email_attempts_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "commerce_email_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Physical invariants (not expressible in schema.prisma) ─────────────────────────────────────────────
-- Every predicate states its NULL handling explicitly: a CHECK that evaluates to NULL passes silently.
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_counters_check"
  CHECK ("attemptCount" BETWEEN 0 AND 5 AND "snapshotVersion" > 0 AND length("templateVersion") > 0
    AND length("eventKey") > 0 AND "provider" IN ('BREVO', 'CAPTURE'));
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_lease_check"
  CHECK (("dispatchState" = 'LEASED' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    OR ("dispatchState" <> 'LEASED' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL));
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_outcome_check"
  CHECK (("dispatchState" <> 'ACCEPTED' OR ("acceptedAt" IS NOT NULL AND "providerMessageId" IS NOT NULL))
    AND ("dispatchState" <> 'FAILED' OR "failedAt" IS NOT NULL)
    AND ("dispatchState" <> 'UNCERTAIN' OR "uncertainAt" IS NOT NULL));
-- Delivery evidence exists only for a message the provider accepted (or whose acceptance is unresolved).
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_delivery_check"
  CHECK (("deliveryState" = 'UNKNOWN' OR "dispatchState" IN ('ACCEPTED', 'UNCERTAIN'))
    AND ("deliveryState" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL));
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_payment_check"
  CHECK ("type" NOT IN ('PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED') OR "paymentId" IS NOT NULL);
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_transition_check"
  CHECK (("fromStatus" IS NULL OR "fromStatus" IN ('AWAITING_CAPTURE', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'))
    AND ("toStatus" IS NULL OR "toStatus" IN ('AWAITING_CAPTURE', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'))
    AND (("type" IN ('ORDER_PREPARING', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'ORDER_CANCELLED')
        AND "transitionId" IS NOT NULL AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL AND "fromStatus" <> "toStatus"
        AND "toStatus" = CASE "type" WHEN 'ORDER_PREPARING' THEN 'PREPARING' WHEN 'ORDER_OUT_FOR_DELIVERY' THEN 'OUT_FOR_DELIVERY'
          WHEN 'ORDER_DELIVERED' THEN 'DELIVERED' ELSE 'CANCELLED' END)
      OR ("type" NOT IN ('ORDER_PREPARING', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'ORDER_CANCELLED')
        AND "transitionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)));
-- Payload states (Task 03.8 §6.2 as corrected):
--   dispatchable / non-purged: nonempty recipient and an object snapshot;
--   initially SUPPRESSED: recipient may be NULL; a (minimal) object snapshot and a suppression reason are required;
--   privacy-purged: terminal, non-actionable rows only, recipient and snapshot both NULL, dedupe identity retained.
ALTER TABLE "commerce_email_outbox" ADD CONSTRAINT "commerce_email_outbox_payload_check"
  CHECK ((("dispatchState" = 'SUPPRESSED') = ("suppressionReason" IS NOT NULL))
    AND (("payloadPurgedAt" IS NULL AND "snapshot" IS NOT NULL AND jsonb_typeof("snapshot") = 'object'
          AND pg_column_size("snapshot") <= 262144
          AND ("dispatchState" = 'SUPPRESSED' OR ("recipient" IS NOT NULL AND length(btrim("recipient")) > 0)))
      OR ("payloadPurgedAt" IS NOT NULL AND "recipient" IS NULL AND "snapshot" IS NULL
          AND "dispatchState" IN ('ACCEPTED', 'FAILED', 'SUPPRESSED'))));

ALTER TABLE "commerce_email_attempts" ADD CONSTRAINT "commerce_email_attempts_state_check"
  CHECK ("attemptNumber" BETWEEN 1 AND 5
    AND ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599)
    AND (("outcome" = 'STARTED') = ("finishedAt" IS NULL))
    AND ("outcome" <> 'ACCEPTED' OR "providerMessageId" IS NOT NULL));

-- ─── Transition guards ──────────────────────────────────────────────────────────────────────────────────
-- Event identity and payload are immutable; SUPPRESSED, ACCEPTED and FAILED are terminal; a purge is one-way; provider
-- evidence is never rewritten or downgraded; a finished attempt is never rewritten. A stale worker or a careless manual
-- UPDATE therefore cannot turn a suppressed or purged event back into dispatchable work. These triggers never send anything.
CREATE FUNCTION "commerce_email_outbox_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."eventKey" IS DISTINCT FROM OLD."eventKey" OR NEW."type" IS DISTINCT FROM OLD."type"
    OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
    OR NEW."transitionId" IS DISTINCT FROM OLD."transitionId" OR NEW."fromStatus" IS DISTINCT FROM OLD."fromStatus"
    OR NEW."toStatus" IS DISTINCT FROM OLD."toStatus" OR NEW."snapshotVersion" IS DISTINCT FROM OLD."snapshotVersion"
    OR NEW."templateVersion" IS DISTINCT FROM OLD."templateVersion" OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR (NEW."userId" IS DISTINCT FROM OLD."userId" AND NEW."userId" IS NOT NULL) THEN
    RAISE EXCEPTION 'commerce email event identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."payloadPurgedAt" IS NOT NULL AND NEW."payloadPurgedAt" IS DISTINCT FROM OLD."payloadPurgedAt" THEN
    RAISE EXCEPTION 'a purged commerce email payload cannot be restored' USING ERRCODE = '23514';
  END IF;
  IF (NEW."recipient" IS DISTINCT FROM OLD."recipient" OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot")
    AND NOT (OLD."payloadPurgedAt" IS NULL AND NEW."payloadPurgedAt" IS NOT NULL AND NEW."recipient" IS NULL AND NEW."snapshot" IS NULL) THEN
    RAISE EXCEPTION 'commerce email recipient and snapshot are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."dispatchState" IN ('SUPPRESSED', 'ACCEPTED', 'FAILED') AND NEW."dispatchState" IS DISTINCT FROM OLD."dispatchState" THEN
    RAISE EXCEPTION 'terminal commerce email dispatch state cannot change' USING ERRCODE = '23514';
  END IF;
  IF (OLD."providerMessageId" IS NOT NULL AND NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId")
    OR (OLD."acceptedAt" IS NOT NULL AND NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt")
    OR NEW."attemptCount" < OLD."attemptCount"
    OR (OLD."deliveryState" <> 'UNKNOWN' AND NEW."deliveryState" = 'UNKNOWN')
    OR (OLD."deliveryState" = 'DELIVERED' AND NEW."deliveryState" NOT IN ('DELIVERED', 'BOUNCED', 'BLOCKED')) THEN
    RAISE EXCEPTION 'commerce email provider evidence cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "commerce_email_outbox_guard" BEFORE UPDATE ON "commerce_email_outbox"
  FOR EACH ROW EXECUTE FUNCTION "commerce_email_outbox_guard"();

CREATE FUNCTION "commerce_email_attempts_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."outboxId" IS DISTINCT FROM OLD."outboxId"
    OR NEW."attemptNumber" IS DISTINCT FROM OLD."attemptNumber" OR NEW."leaseToken" IS DISTINCT FROM OLD."leaseToken"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt" OR OLD."outcome" <> 'STARTED' THEN
    RAISE EXCEPTION 'a commerce email attempt record is append-only once finished' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "commerce_email_attempts_guard" BEFORE UPDATE ON "commerce_email_attempts"
  FOR EACH ROW EXECUTE FUNCTION "commerce_email_attempts_guard"();

-- ─── Exposure ───────────────────────────────────────────────────────────────────────────────────────────
-- Backend-private queue, not a browser Data API surface. Prisma uses the server DB role (table owner).
ALTER TABLE "commerce_email_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commerce_email_attempts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "commerce_email_outbox", "commerce_email_attempts" FROM PUBLIC;
REVOKE ALL ON FUNCTION "commerce_email_outbox_guard"(), "commerce_email_attempts_guard"() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "commerce_email_outbox", "commerce_email_attempts" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "commerce_email_outbox", "commerce_email_attempts" FROM authenticated;
  END IF;
END $$;

COMMIT;
