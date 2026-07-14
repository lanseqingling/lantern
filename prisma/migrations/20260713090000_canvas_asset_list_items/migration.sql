CREATE TYPE "AssetLibraryStatus" AS ENUM ('CANVAS_ONLY', 'LIBRARY');

ALTER TABLE "Asset"
ADD COLUMN "libraryStatus" "AssetLibraryStatus" NOT NULL DEFAULT 'LIBRARY';

CREATE TABLE "CanvasAssetListItem" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "displayKind" "AssetKind" NOT NULL,
  "sortIndex" INTEGER NOT NULL DEFAULT 0,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "hiddenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanvasAssetListItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvasAssetListItem_projectId_assetId_key" ON "CanvasAssetListItem"("projectId", "assetId");
CREATE INDEX "CanvasAssetListItem_ownerUserId_projectId_hiddenAt_pinned_sortIndex_idx" ON "CanvasAssetListItem"("ownerUserId", "projectId", "hiddenAt", "pinned", "sortIndex");

ALTER TABLE "CanvasAssetListItem"
ADD CONSTRAINT "CanvasAssetListItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "CanvasAssetListItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "CanvasAssetListItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing project assets were already visible in the old sidebar. Backfill a
-- project-local list row so the migration preserves that behavior.
INSERT INTO "CanvasAssetListItem" ("id", "ownerUserId", "projectId", "assetId", "displayName", "displayKind", "sortIndex", "createdAt", "updatedAt")
SELECT CONCAT('canvas-list-', "id"), "ownerUserId", "projectId", "id", "name", "kind", 0, "createdAt", "updatedAt"
FROM "Asset"
WHERE "archivedAt" IS NULL;
