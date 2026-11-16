CREATE TYPE "SecurityEventType" AS ENUM ('EMAIL_VERIFIED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'EMAIL_CHANGED', 'GOOGLE_CONNECTED', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT');

CREATE TABLE "security_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "type" "SecurityEventType" NOT NULL,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_events_userId_createdAt_idx" ON "security_events"("userId", "createdAt");
CREATE INDEX "security_events_type_createdAt_idx" ON "security_events"("type", "createdAt");
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "security_events" ENABLE ROW LEVEL SECURITY;
