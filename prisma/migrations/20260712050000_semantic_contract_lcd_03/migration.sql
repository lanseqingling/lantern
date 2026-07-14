-- Semantic contract v0.3
--
-- StoryboardBeat is narrative planning. ComicFrame is a visible page unit in
-- LCD. The former Panel/PanelVersion names conflated those layers.

ALTER TYPE "TaskType" RENAME VALUE 'LAYOUT' TO 'PAGE_LAYOUT';
ALTER TYPE "TaskType" RENAME VALUE 'PANEL_GENERATE' TO 'FRAME_IMAGE_GENERATE';
ALTER TYPE "TaskType" RENAME VALUE 'PANEL_REFINE' TO 'FRAME_IMAGE_REFINE';

ALTER TYPE "CandidateKind" RENAME VALUE 'LAYOUT' TO 'PAGE_LAYOUT';
ALTER TYPE "CandidateKind" RENAME VALUE 'PANEL_IMAGE' TO 'FRAME_IMAGE';
ALTER TYPE "CandidateKind" RENAME VALUE 'PANEL_PATCH' TO 'FRAME_IMAGE_PATCH';

ALTER TABLE "WorkingRevision" RENAME COLUMN "panels" TO "storyboardBeats";
ALTER TABLE "WorkingRevision" RENAME COLUMN "panelVersionHeads" TO "storyboardBeatVersionHeads";
ALTER TABLE "SavedSnapshot" RENAME COLUMN "panelVersions" TO "storyboardBeatVersions";

ALTER TABLE "PanelVersion" RENAME COLUMN "panelId" TO "storyboardBeatId";
ALTER TABLE "PanelVersion" RENAME TO "StoryboardBeatVersion";
ALTER TABLE "Panel" RENAME TO "StoryboardBeat";

ALTER TABLE "StoryboardBeat" RENAME CONSTRAINT "Panel_pkey" TO "StoryboardBeat_pkey";
ALTER TABLE "StoryboardBeat" RENAME CONSTRAINT "Panel_projectId_fkey" TO "StoryboardBeat_projectId_fkey";
ALTER TABLE "StoryboardBeatVersion" RENAME CONSTRAINT "PanelVersion_pkey" TO "StoryboardBeatVersion_pkey";
ALTER TABLE "StoryboardBeatVersion" RENAME CONSTRAINT "PanelVersion_panelId_fkey" TO "StoryboardBeatVersion_storyboardBeatId_fkey";

ALTER INDEX "Panel_ownerUserId_projectId_archivedAt_idx" RENAME TO "StoryboardBeat_ownerUserId_projectId_archivedAt_idx";
ALTER INDEX "PanelVersion_panelId_createdAt_idx" RENAME TO "StoryboardBeatVersion_storyboardBeatId_createdAt_idx";
ALTER INDEX "PanelVersion_panelId_version_key" RENAME TO "StoryboardBeatVersion_storyboardBeatId_version_key";
