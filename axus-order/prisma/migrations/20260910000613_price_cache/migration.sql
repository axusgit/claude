-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN "cachedReplacementPrice" REAL;
ALTER TABLE "CatalogItem" ADD COLUMN "cachedUnitPrice" REAL;
ALTER TABLE "CatalogItem" ADD COLUMN "pricedAt" DATETIME;
