-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Comic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "worldSummary" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'PAGE',
    "canvasPageMode" TEXT NOT NULL DEFAULT 'SINGLE',
    "readingDirection" TEXT NOT NULL DEFAULT 'ltr',
    "styleSummary" TEXT NOT NULL DEFAULT '',
    "coverObjectKey" TEXT,
    "coverContentType" TEXT,
    "coverWidth" INTEGER,
    "coverHeight" INTEGER,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Comic_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComicSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "comicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "contextEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ComicSetting_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComicSetting_comicId_fkey" FOREIGN KEY ("comicId") REFERENCES "Comic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "comicId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "coverObjectKey" TEXT,
    "coverContentType" TEXT,
    "coverWidth" INTEGER,
    "coverHeight" INTEGER,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Chapter_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Chapter_comicId_fkey" FOREIGN KEY ("comicId") REFERENCES "Comic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkingRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "storyboardBeats" JSONB NOT NULL,
    "storyboardBeatVersionHeads" JSONB NOT NULL DEFAULT '{}',
    "assetVersionHeads" JSONB NOT NULL DEFAULT '{}',
    "changeSet" JSONB,
    "sourceCandidateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkingRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceWorkingRevision" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "storyboardBeatVersions" JSONB NOT NULL,
    "assetVersions" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedSnapshot_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SavedSnapshot_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SavedSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryboardBeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoryboardBeat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryboardBeatVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyboardBeatId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryboardBeatVersion_storyboardBeatId_fkey" FOREIGN KEY ("storyboardBeatId") REFERENCES "StoryboardBeat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
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
    CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Asset_variantOfAssetId_fkey" FOREIGN KEY ("variantOfAssetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CanvasAssetListItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "displayKind" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "hiddenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CanvasAssetListItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CanvasAssetListItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CanvasAssetListItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "objectKey" TEXT,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "source" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssetImage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetImage_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '创作对话',
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentConversation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PLAIN',
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "versionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageReference_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CanvasReferencePlacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "zoom" REAL NOT NULL DEFAULT 1,
    "zIndex" INTEGER NOT NULL DEFAULT 10,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CanvasReferencePlacement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CanvasReferencePlacement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CanvasReferencePlacement_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT,
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

-- CreateTable
CREATE TABLE "GenerationAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "responseMeta" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "GenerationAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "GenerationTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "title" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "sourceRefs" JSONB NOT NULL DEFAULT '[]',
    "outputRefs" JSONB NOT NULL DEFAULT '[]',
    "payload" JSONB NOT NULL,
    "operations" JSONB NOT NULL DEFAULT '[]',
    "appliedRevision" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Candidate_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Candidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Candidate_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Candidate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "GenerationTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Comic_ownerUserId_archivedAt_idx" ON "Comic"("ownerUserId", "archivedAt");

-- CreateIndex
CREATE INDEX "ComicSetting_ownerUserId_comicId_archivedAt_contextEnabled_sortIndex_idx" ON "ComicSetting"("ownerUserId", "comicId", "archivedAt", "contextEnabled", "sortIndex");

-- CreateIndex
CREATE INDEX "Chapter_ownerUserId_archivedAt_idx" ON "Chapter"("ownerUserId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_comicId_number_key" ON "Chapter"("comicId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Project_chapterId_key" ON "Project"("chapterId");

-- CreateIndex
CREATE INDEX "Project_ownerUserId_idx" ON "Project"("ownerUserId");

-- CreateIndex
CREATE INDEX "WorkingRevision_projectId_createdAt_idx" ON "WorkingRevision"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingRevision_projectId_revision_key" ON "WorkingRevision"("projectId", "revision");

-- CreateIndex
CREATE INDEX "SavedSnapshot_ownerUserId_chapterId_createdAt_idx" ON "SavedSnapshot"("ownerUserId", "chapterId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedSnapshot_projectId_sourceWorkingRevision_idx" ON "SavedSnapshot"("projectId", "sourceWorkingRevision");

-- CreateIndex
CREATE INDEX "StoryboardBeat_ownerUserId_projectId_archivedAt_idx" ON "StoryboardBeat"("ownerUserId", "projectId", "archivedAt");

-- CreateIndex
CREATE INDEX "StoryboardBeatVersion_storyboardBeatId_createdAt_idx" ON "StoryboardBeatVersion"("storyboardBeatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoryboardBeatVersion_storyboardBeatId_version_key" ON "StoryboardBeatVersion"("storyboardBeatId", "version");

-- CreateIndex
CREATE INDEX "Asset_ownerUserId_projectId_kind_archivedAt_idx" ON "Asset"("ownerUserId", "projectId", "kind", "archivedAt");

-- CreateIndex
CREATE INDEX "Asset_variantOfAssetId_variantSortIndex_createdAt_idx" ON "Asset"("variantOfAssetId", "variantSortIndex", "createdAt");

-- CreateIndex
CREATE INDEX "CanvasAssetListItem_ownerUserId_projectId_hiddenAt_pinned_sortIndex_idx" ON "CanvasAssetListItem"("ownerUserId", "projectId", "hiddenAt", "pinned", "sortIndex");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasAssetListItem_projectId_assetId_key" ON "CanvasAssetListItem"("projectId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_objectKey_key" ON "AssetVersion"("objectKey");

-- CreateIndex
CREATE INDEX "AssetVersion_assetId_createdAt_idx" ON "AssetVersion"("assetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_version_key" ON "AssetVersion"("assetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssetImage_assetVersionId_key" ON "AssetImage"("assetVersionId");

-- CreateIndex
CREATE INDEX "AssetImage_assetId_sortIndex_createdAt_idx" ON "AssetImage"("assetId", "sortIndex", "createdAt");

-- CreateIndex
CREATE INDEX "AgentConversation_ownerUserId_projectId_archivedAt_idx" ON "AgentConversation"("ownerUserId", "projectId", "archivedAt");

-- CreateIndex
CREATE INDEX "Message_ownerUserId_projectId_conversationId_createdAt_idx" ON "Message"("ownerUserId", "projectId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageReference_messageId_idx" ON "MessageReference"("messageId");

-- CreateIndex
CREATE INDEX "MessageReference_objectType_objectId_versionId_idx" ON "MessageReference"("objectType", "objectId", "versionId");

-- CreateIndex
CREATE INDEX "CanvasReferencePlacement_ownerUserId_projectId_idx" ON "CanvasReferencePlacement"("ownerUserId", "projectId");

-- CreateIndex
CREATE INDEX "CanvasReferencePlacement_assetId_assetVersionId_idx" ON "CanvasReferencePlacement"("assetId", "assetVersionId");

-- CreateIndex
CREATE INDEX "GenerationTask_ownerUserId_projectId_status_createdAt_idx" ON "GenerationTask"("ownerUserId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationTask_ownerUserId_idempotencyKey_key" ON "GenerationTask"("ownerUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "GenerationAttempt_taskId_startedAt_idx" ON "GenerationAttempt"("taskId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationAttempt_taskId_attempt_key" ON "GenerationAttempt"("taskId", "attempt");

-- CreateIndex
CREATE INDEX "Candidate_ownerUserId_projectId_status_createdAt_idx" ON "Candidate"("ownerUserId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Candidate_conversationId_status_createdAt_idx" ON "Candidate"("conversationId", "status", "createdAt");
