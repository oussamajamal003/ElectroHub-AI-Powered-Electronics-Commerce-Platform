-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "providerAccountId" VARCHAR(255) NOT NULL,
    "providerEmail" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

-- CreateIndex
CREATE INDEX "oauth_accounts_provider_providerEmail_idx" ON "oauth_accounts"("provider", "providerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_providerAccountId_key" ON "oauth_accounts"("provider", "providerAccountId");

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_accounts" ENABLE ROW LEVEL SECURITY;
