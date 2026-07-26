-- CreateTable
CREATE TABLE "AgentDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "baseWorkingRevision" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Agent 方案',
    "sourceHost" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentDraft_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentDraftRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentDraftId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "storyboardBeats" JSONB NOT NULL,
    "storyboardBeatVersionHeads" JSONB NOT NULL DEFAULT '{}',
    "assetVersionHeads" JSONB NOT NULL DEFAULT '{}',
    "changeSet" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentDraftRevision_agentDraftId_fkey" FOREIGN KEY ("agentDraftId") REFERENCES "AgentDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChangeProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentDraftId" TEXT NOT NULL,
    "agentDraftRevisionId" TEXT NOT NULL,
    "baseWorkingRevision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "acceptedWorkingRevision" INTEGER,
    "acceptedSnapshotId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChangeProposal_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChangeProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChangeProposal_agentDraftId_fkey" FOREIGN KEY ("agentDraftId") REFERENCES "AgentDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChangeProposal_agentDraftRevisionId_fkey" FOREIGN KEY ("agentDraftRevisionId") REFERENCES "AgentDraftRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentDraft_ownerUserId_projectId_status_updatedAt_idx" ON "AgentDraft"("ownerUserId", "projectId", "status", "updatedAt");
CREATE INDEX "AgentDraft_projectId_baseWorkingRevision_idx" ON "AgentDraft"("projectId", "baseWorkingRevision");
CREATE UNIQUE INDEX "AgentDraftRevision_agentDraftId_revision_key" ON "AgentDraftRevision"("agentDraftId", "revision");
CREATE INDEX "AgentDraftRevision_agentDraftId_createdAt_idx" ON "AgentDraftRevision"("agentDraftId", "createdAt");
CREATE INDEX "ChangeProposal_ownerUserId_projectId_status_createdAt_idx" ON "ChangeProposal"("ownerUserId", "projectId", "status", "createdAt");
CREATE INDEX "ChangeProposal_projectId_baseWorkingRevision_idx" ON "ChangeProposal"("projectId", "baseWorkingRevision");
CREATE UNIQUE INDEX "ChangeProposal_agentDraftId_key" ON "ChangeProposal"("agentDraftId");
