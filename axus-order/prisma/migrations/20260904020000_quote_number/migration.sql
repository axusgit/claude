-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "quoteNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_quoteNumber_key" ON "Quote"("quoteNumber");
