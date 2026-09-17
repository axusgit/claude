-- CreateTable
CREATE TABLE "IpGeo" (
    "ip" TEXT NOT NULL PRIMARY KEY,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "org" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
