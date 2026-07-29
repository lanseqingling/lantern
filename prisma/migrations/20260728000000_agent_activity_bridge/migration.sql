-- CreateTable
CREATE TABLE "AgentActivityGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'EXTERNAL_MCP',
    "sourceReference" TEXT,
    "agentDraftId" TEXT,
    "title" TEXT NOT NULL DEFAULT '外部 Agent 编辑',
    "observedStatus" TEXT NOT NULL DEFAULT 'RUNNING',
    "lastObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observedExpiresAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentActivityGroup_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentActivityGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentActivityGroup_agentDraftId_fkey" FOREIGN KEY ("agentDraftId") REFERENCES "AgentDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "externalOperationId" TEXT,
    "dedupeKey" TEXT,
    "capabilityId" TEXT,
    "toolName" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "observedStatus" TEXT NOT NULL DEFAULT 'RUNNING',
    "projection" JSONB NOT NULL DEFAULT '{}',
    "navigation" JSONB,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentActivityEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AgentActivityGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentActivityEvent_externalOperationId_fkey" FOREIGN KEY ("externalOperationId") REFERENCES "ExternalAgentOperation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentActivityGroup_agentDraftId_key" ON "AgentActivityGroup"("agentDraftId");
CREATE INDEX "AgentActivityGroup_ownerUserId_projectId_updatedAt_idx" ON "AgentActivityGroup"("ownerUserId", "projectId", "updatedAt");
CREATE INDEX "AgentActivityGroup_sourceType_observedStatus_observedExpiresAt_idx" ON "AgentActivityGroup"("sourceType", "observedStatus", "observedExpiresAt");
CREATE UNIQUE INDEX "AgentActivityEvent_externalOperationId_key" ON "AgentActivityEvent"("externalOperationId");
CREATE UNIQUE INDEX "AgentActivityEvent_groupId_dedupeKey_key" ON "AgentActivityEvent"("groupId", "dedupeKey");
CREATE INDEX "AgentActivityEvent_groupId_startedAt_idx" ON "AgentActivityEvent"("groupId", "startedAt");
CREATE INDEX "AgentActivityEvent_observedStatus_updatedAt_idx" ON "AgentActivityEvent"("observedStatus", "updatedAt");
