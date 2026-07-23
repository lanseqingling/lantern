PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Comic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "worldSummary" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'PAGE',
    "defaultReadingDirection" TEXT NOT NULL DEFAULT 'LTR',
    "styleSummary" TEXT NOT NULL DEFAULT '',
    "coverObjectKey" TEXT,
    "coverContentType" TEXT,
    "coverWidth" INTEGER,
    "coverHeight" INTEGER,
    "isExample" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Comic_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Comic" (
    "id", "ownerUserId", "title", "summary", "worldSummary", "format",
    "defaultReadingDirection", "styleSummary", "coverObjectKey", "coverContentType",
    "coverWidth", "coverHeight", "isExample", "archivedAt", "createdAt", "updatedAt"
)
SELECT
    "id", "ownerUserId", "title", "summary", "worldSummary", "format",
    CASE WHEN lower("readingDirection") = 'rtl' THEN 'RTL' ELSE 'LTR' END,
    "styleSummary", "coverObjectKey", "coverContentType", "coverWidth", "coverHeight",
    "isExample", "archivedAt", "createdAt", "updatedAt"
FROM "Comic";

DROP TABLE "Comic";
ALTER TABLE "new_Comic" RENAME TO "Comic";
CREATE INDEX "Comic_ownerUserId_archivedAt_idx" ON "Comic"("ownerUserId", "archivedAt");

ALTER TABLE "Project" DROP COLUMN "settings";
ALTER TABLE "WorkingRevision" DROP COLUMN "sourceCandidateId";
ALTER TABLE "CanvasAssetListItem" DROP COLUMN "displayKind";

CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "comicId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "libraryStatus" TEXT NOT NULL DEFAULT 'LIBRARY',
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "variantOfAssetId" TEXT,
    "variantLabel" TEXT,
    "variantSortIndex" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Asset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Asset_comicId_fkey" FOREIGN KEY ("comicId") REFERENCES "Comic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Asset_variantOfAssetId_fkey" FOREIGN KEY ("variantOfAssetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Asset" (
    "id", "ownerUserId", "comicId", "kind", "name", "description", "libraryStatus",
    "currentVersionNumber", "variantOfAssetId", "variantLabel", "variantSortIndex",
    "archivedAt", "createdAt", "updatedAt"
)
SELECT
    "Asset"."id",
    "Asset"."ownerUserId",
    "Chapter"."comicId",
    "Asset"."kind",
    "Asset"."name",
    "Asset"."description",
    "Asset"."libraryStatus",
    "Asset"."currentVersionNumber",
    "Asset"."variantOfAssetId",
    "Asset"."variantLabel",
    "Asset"."variantSortIndex",
    "Asset"."archivedAt",
    "Asset"."createdAt",
    "Asset"."updatedAt"
FROM "Asset"
INNER JOIN "Project" ON "Project"."id" = "Asset"."projectId"
INNER JOIN "Chapter" ON "Chapter"."id" = "Project"."chapterId";

DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE INDEX "Asset_ownerUserId_comicId_kind_archivedAt_idx" ON "Asset"("ownerUserId", "comicId", "kind", "archivedAt");
CREATE INDEX "Asset_variantOfAssetId_variantSortIndex_createdAt_idx" ON "Asset"("variantOfAssetId", "variantSortIndex", "createdAt");

ALTER TABLE "AssetVersion" RENAME COLUMN "source" TO "origin";
UPDATE "AssetVersion"
SET "origin" = CASE
    WHEN "origin" = 'external_upload' THEN 'EXTERNAL_UPLOAD'
    WHEN "origin" = 'chapter_archive_import' THEN 'CHAPTER_ARCHIVE_IMPORT'
    WHEN "origin" = 'migration' THEN 'MIGRATION'
    WHEN "origin" = 'upload' THEN 'UPLOAD'
    ELSE 'GENERATED'
END;

CREATE TABLE "new_GenerationTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT,
    "capabilityId" TEXT NOT NULL,
    "capabilityVersion" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "input" JSONB NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "output" JSONB,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "cancelRequestedAt" DATETIME,
    "completedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationTask_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GenerationTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GenerationTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_GenerationTask" (
    "id", "ownerUserId", "projectId", "conversationId", "capabilityId", "capabilityVersion",
    "type", "status", "idempotencyKey", "baseRevision", "scope", "target", "input",
    "contextSnapshot", "output", "provider", "model", "progress", "cancelRequestedAt",
    "completedAt", "errorCode", "errorMessage", "createdAt", "updatedAt"
)
SELECT
    "id",
    "ownerUserId",
    "projectId",
    "conversationId",
    COALESCE(json_extract("input", '$.capability.id'), CASE "type"
        WHEN 'STORYBOARD' THEN 'storyboard.edit_single_entry'
        WHEN 'PAGE_LAYOUT' THEN 'page_layout.generate'
        WHEN 'FRAME_IMAGE_GENERATE' THEN 'frame_image.generate_or_replace'
        WHEN 'FRAME_IMAGE_REFINE' THEN 'frame_image.refine'
        WHEN 'ASSET_PARSE' THEN 'asset.generate_character_or_scene'
        WHEN 'DIALOGUE' THEN 'dialogue.generate'
        WHEN 'EXPORT' THEN 'chapter.export'
        ELSE 'task.execute'
    END),
    COALESCE(json_extract("input", '$.capability.version'), 1),
    CASE WHEN "type" = 'ASSET_PARSE' THEN 'ASSET_IMAGE_GENERATE' ELSE "type" END,
    CASE WHEN "status" = 'CANCEL_REQUESTED' THEN 'CANCELED' ELSE "status" END,
    "idempotencyKey",
    "baseRevision",
    "scope",
    "target",
    "input",
    "contextSnapshot",
    "output",
    "provider",
    "model",
    "progress",
    "cancelRequestedAt",
    CASE WHEN "status" = 'CANCEL_REQUESTED' THEN COALESCE("completedAt", CURRENT_TIMESTAMP) ELSE "completedAt" END,
    "errorCode",
    "errorMessage",
    "createdAt",
    "updatedAt"
FROM "GenerationTask";

DROP TABLE "GenerationTask";
ALTER TABLE "new_GenerationTask" RENAME TO "GenerationTask";
CREATE UNIQUE INDEX "GenerationTask_ownerUserId_idempotencyKey_key" ON "GenerationTask"("ownerUserId", "idempotencyKey");
CREATE INDEX "GenerationTask_ownerUserId_projectId_status_createdAt_idx" ON "GenerationTask"("ownerUserId", "projectId", "status", "createdAt");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
