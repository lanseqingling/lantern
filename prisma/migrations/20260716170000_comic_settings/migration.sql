-- Creator-defined comic-level setting cards intentionally have no fixed kind.
CREATE TABLE "ComicSetting" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "comicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "contextEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComicSetting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComicSetting_ownerUserId_comicId_archivedAt_contextEnabled_sortIndex_idx"
ON "ComicSetting"("ownerUserId", "comicId", "archivedAt", "contextEnabled", "sortIndex");

ALTER TABLE "ComicSetting"
ADD CONSTRAINT "ComicSetting_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ComicSetting"
ADD CONSTRAINT "ComicSetting_comicId_fkey"
FOREIGN KEY ("comicId") REFERENCES "Comic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
