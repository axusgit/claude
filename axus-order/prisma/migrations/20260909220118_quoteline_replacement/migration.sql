-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QuoteLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "description" TEXT NOT NULL,
    "synnexSKU" TEXT,
    "qty" INTEGER NOT NULL,
    "unitBallpark" REAL,
    "lineTotal" REAL,
    "unitCostSnapshot" REAL,
    "status" TEXT NOT NULL,
    "usedReplacement" BOOLEAN NOT NULL DEFAULT false,
    "originalName" TEXT,
    CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteLine_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_QuoteLine" ("catalogItemId", "description", "id", "lineTotal", "qty", "quoteId", "status", "synnexSKU", "unitBallpark", "unitCostSnapshot") SELECT "catalogItemId", "description", "id", "lineTotal", "qty", "quoteId", "status", "synnexSKU", "unitBallpark", "unitCostSnapshot" FROM "QuoteLine";
DROP TABLE "QuoteLine";
ALTER TABLE "new_QuoteLine" RENAME TO "QuoteLine";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
