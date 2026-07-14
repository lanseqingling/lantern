CREATE TABLE "PageVariant" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "commands" JSONB NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "sourceCandidateId" TEXT,
    "thumbnailAssetVersionId" TEXT,
    "lastAppliedRevision" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PageVariant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PageVariant_ownerUserId_projectId_unitId_archivedAt_createdAt_idx"
ON "PageVariant"("ownerUserId", "projectId", "unitId", "archivedAt", "createdAt");

ALTER TABLE "PageVariant" ADD CONSTRAINT "PageVariant_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PageVariant" ADD CONSTRAINT "PageVariant_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
