-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "isTemplate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextOccurrenceAt" TIMESTAMP(3),
ADD COLUMN     "recurringTemplateId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyOnExpense" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyOnSettlement" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "weeklyDigest" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "targetId" TEXT,
    "groupId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rateScaled" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "ExchangeRate_date_idx" ON "ExchangeRate"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_baseCurrency_quoteCurrency_date_key" ON "ExchangeRate"("baseCurrency", "quoteCurrency", "date");

-- CreateIndex
CREATE INDEX "Expense_isTemplate_nextOccurrenceAt_idx" ON "Expense"("isTemplate", "nextOccurrenceAt");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_recurringTemplateId_date_key" ON "Expense"("recurringTemplateId", "date");

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

