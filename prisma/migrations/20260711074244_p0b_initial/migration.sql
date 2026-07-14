-- CreateEnum
CREATE TYPE "ComicFormat" AS ENUM ('PAGE', 'VERTICAL', 'FOUR_PANEL');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('CHARACTER', 'SCENE', 'STYLE', 'PROP', 'REFERENCE_IMAGE', 'SKETCH', 'GENERATED_IMAGE');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('PLAIN', 'QUESTION', 'CONFIRMATION', 'TASK', 'CANDIDATE', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('STORYBOARD', 'LAYOUT', 'PANEL_GENERATE', 'PANEL_REFINE', 'ASSET_PARSE', 'DIALOGUE', 'EXPORT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('CREATED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CandidateKind" AS ENUM ('STORYBOARD', 'LAYOUT', 'PANEL_IMAGE', 'PANEL_PATCH', 'ASSET', 'DIALOGUE');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('AVAILABLE', 'APPLIED', 'DISCARDED', 'STALE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comic" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "format" "ComicFormat" NOT NULL DEFAULT 'PAGE',
    "readingDirection" TEXT NOT NULL DEFAULT 'ltr',
    "styleSummary" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "comicId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "panels" JSONB NOT NULL,
    "panelVersionHeads" JSONB NOT NULL DEFAULT '{}',
    "assetVersionHeads" JSONB NOT NULL DEFAULT '{}',
    "changeSet" JSONB,
    "sourceCandidateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSnapshot" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceWorkingRevision" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "panelVersions" JSONB NOT NULL,
    "assetVersions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Panel" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelVersion" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storyPurpose" TEXT NOT NULL,
    "shotType" TEXT NOT NULL,
    "cameraAngle" TEXT,
    "composition" TEXT NOT NULL,
    "characterIds" JSONB NOT NULL DEFAULT '[]',
    "sceneId" TEXT,
    "action" TEXT NOT NULL,
    "emotion" TEXT,
    "dialogue" TEXT,
    "continuityHints" JSONB NOT NULL DEFAULT '[]',
    "sourceTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PanelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConversation" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '创作对话',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'PLAIN',
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReference" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "versionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasReferencePlacement" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "zoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasReferencePlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationTask" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT,
    "type" "TaskType" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "target" JSONB NOT NULL,
    "input" JSONB NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "cancelRequestedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationAttempt" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "providerRequestId" TEXT,
    "responseMeta" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "conversationId" TEXT,
    "taskId" TEXT NOT NULL,
    "kind" "CandidateKind" NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'AVAILABLE',
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Comic_ownerUserId_archivedAt_idx" ON "Comic"("ownerUserId", "archivedAt");

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
CREATE INDEX "Panel_ownerUserId_projectId_archivedAt_idx" ON "Panel"("ownerUserId", "projectId", "archivedAt");

-- CreateIndex
CREATE INDEX "PanelVersion_panelId_createdAt_idx" ON "PanelVersion"("panelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PanelVersion_panelId_version_key" ON "PanelVersion"("panelId", "version");

-- CreateIndex
CREATE INDEX "Asset_ownerUserId_projectId_kind_archivedAt_idx" ON "Asset"("ownerUserId", "projectId", "kind", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_objectKey_key" ON "AssetVersion"("objectKey");

-- CreateIndex
CREATE INDEX "AssetVersion_assetId_createdAt_idx" ON "AssetVersion"("assetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_version_key" ON "AssetVersion"("assetId", "version");

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

-- AddForeignKey
ALTER TABLE "Comic" ADD CONSTRAINT "Comic_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_comicId_fkey" FOREIGN KEY ("comicId") REFERENCES "Comic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingRevision" ADD CONSTRAINT "WorkingRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSnapshot" ADD CONSTRAINT "SavedSnapshot_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSnapshot" ADD CONSTRAINT "SavedSnapshot_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSnapshot" ADD CONSTRAINT "SavedSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Panel" ADD CONSTRAINT "Panel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelVersion" ADD CONSTRAINT "PanelVersion_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReference" ADD CONSTRAINT "MessageReference_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasReferencePlacement" ADD CONSTRAINT "CanvasReferencePlacement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasReferencePlacement" ADD CONSTRAINT "CanvasReferencePlacement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasReferencePlacement" ADD CONSTRAINT "CanvasReferencePlacement_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationAttempt" ADD CONSTRAINT "GenerationAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "GenerationTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "GenerationTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
