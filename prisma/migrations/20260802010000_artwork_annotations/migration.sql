-- CreateTable
CREATE TABLE "ArtworkAnnotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdWorkingRevision" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" DATETIME,
    "dismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArtworkAnnotation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ArtworkAnnotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtworkAnnotationReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "annotationId" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL,
    "anchorKind" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "surfaceId" TEXT,
    "objectType" TEXT,
    "objectId" TEXT,
    "localX" REAL,
    "localY" REAL,
    "unitX" REAL NOT NULL,
    "unitY" REAL NOT NULL,
    "targetFingerprint" TEXT,
    CONSTRAINT "ArtworkAnnotationReference_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "ArtworkAnnotation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtworkAnnotationAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "annotationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortIndex" INTEGER NOT NULL,
    CONSTRAINT "ArtworkAnnotationAttachment_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "ArtworkAnnotation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ArtworkAnnotationAttachment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ArtworkAnnotationAttachment_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtworkAnnotationMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "annotationId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArtworkAnnotationMessage_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "ArtworkAnnotation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtworkAnnotationWork" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "annotationId" TEXT NOT NULL,
    "agentDraftId" TEXT NOT NULL,
    "changeProposalId" TEXT,
    "actorType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArtworkAnnotationWork_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "ArtworkAnnotation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ArtworkAnnotationWork_agentDraftId_fkey" FOREIGN KEY ("agentDraftId") REFERENCES "AgentDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ArtworkAnnotationWork_changeProposalId_fkey" FOREIGN KEY ("changeProposalId") REFERENCES "ChangeProposal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ArtworkAnnotation_ownerUserId_projectId_status_updatedAt_idx" ON "ArtworkAnnotation"("ownerUserId", "projectId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkAnnotationReference_annotationId_sortIndex_key" ON "ArtworkAnnotationReference"("annotationId", "sortIndex");

-- CreateIndex
CREATE INDEX "ArtworkAnnotationReference_annotationId_unitId_idx" ON "ArtworkAnnotationReference"("annotationId", "unitId");

-- CreateIndex
CREATE INDEX "ArtworkAnnotationReference_unitId_objectType_objectId_idx" ON "ArtworkAnnotationReference"("unitId", "objectType", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkAnnotationAttachment_annotationId_sortIndex_key" ON "ArtworkAnnotationAttachment"("annotationId", "sortIndex");

-- CreateIndex
CREATE INDEX "ArtworkAnnotationAttachment_assetId_assetVersionId_idx" ON "ArtworkAnnotationAttachment"("assetId", "assetVersionId");

-- CreateIndex
CREATE INDEX "ArtworkAnnotationMessage_annotationId_createdAt_idx" ON "ArtworkAnnotationMessage"("annotationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkAnnotationWork_annotationId_agentDraftId_key" ON "ArtworkAnnotationWork"("annotationId", "agentDraftId");

-- CreateIndex
CREATE INDEX "ArtworkAnnotationWork_agentDraftId_status_idx" ON "ArtworkAnnotationWork"("agentDraftId", "status");

-- CreateIndex
CREATE INDEX "ArtworkAnnotationWork_changeProposalId_idx" ON "ArtworkAnnotationWork"("changeProposalId");
