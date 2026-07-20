-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_clientRequestId_key" ON "Expense"("clientRequestId");

