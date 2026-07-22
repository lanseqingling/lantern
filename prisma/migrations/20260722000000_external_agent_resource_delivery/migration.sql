-- CreateTable
CREATE TABLE "ExternalAssetUpload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filename" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "temporaryObjectKey" TEXT,
    "contentType" TEXT,
    "byteSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "assetVersionId" TEXT,
    "assetImageId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "uploadedAt" DATETIME,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalAssetUpload_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExternalAssetUpload_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExternalAgentOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "capabilityVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "targetReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExternalAgentOperation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAssetUpload_temporaryObjectKey_key" ON "ExternalAssetUpload"("temporaryObjectKey");

-- CreateIndex
CREATE INDEX "ExternalAssetUpload_ownerUserId_assetId_status_createdAt_idx" ON "ExternalAssetUpload"("ownerUserId", "assetId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalAssetUpload_expiresAt_status_idx" ON "ExternalAssetUpload"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAgentOperation_ownerUserId_idempotencyKey_key" ON "ExternalAgentOperation"("ownerUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ExternalAgentOperation_ownerUserId_capabilityId_createdAt_idx" ON "ExternalAgentOperation"("ownerUserId", "capabilityId", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalAgentOperation_ownerUserId_status_updatedAt_idx" ON "ExternalAgentOperation"("ownerUserId", "status", "updatedAt");
