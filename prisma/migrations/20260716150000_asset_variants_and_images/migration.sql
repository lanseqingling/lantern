-- Distinguish semantic asset variants from immutable image revisions.
ALTER TABLE "Asset"
ADD COLUMN "variantOfAssetId" TEXT,
ADD COLUMN "variantLabel" TEXT,
ADD COLUMN "variantSortIndex" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "AssetImage" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetImage_assetVersionId_key" ON "AssetImage"("assetVersionId");
CREATE INDEX "AssetImage_assetId_sortIndex_createdAt_idx" ON "AssetImage"("assetId", "sortIndex", "createdAt");
CREATE INDEX "Asset_variantOfAssetId_variantSortIndex_createdAt_idx" ON "Asset"("variantOfAssetId", "variantSortIndex", "createdAt");

ALTER TABLE "Asset"
ADD CONSTRAINT "Asset_variantOfAssetId_fkey"
FOREIGN KEY ("variantOfAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssetImage"
ADD CONSTRAINT "AssetImage_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssetImage"
ADD CONSTRAINT "AssetImage_assetVersionId_fkey"
FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing assets keep their ids and image revisions. Their latest stored
-- revision becomes the first gallery slot.
INSERT INTO "AssetImage" ("id", "assetId", "assetVersionId", "label", "sortIndex", "createdAt", "updatedAt")
SELECT CONCAT('asset-image-', ranked."id"), ranked."assetId", ranked."id", '主图', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT version.*, ROW_NUMBER() OVER (
        PARTITION BY version."assetId"
        ORDER BY version."version" DESC, version."createdAt" DESC, version."id" DESC
    ) AS row_number
    FROM "AssetVersion" AS version
    WHERE version."objectKey" IS NOT NULL
) AS ranked
WHERE ranked.row_number = 1;
