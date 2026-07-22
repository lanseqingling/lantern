ALTER TABLE "Comic" ADD COLUMN "isExample" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Comic"
SET "isExample" = true
WHERE "id" = 'comic-campus-letter';

UPDATE "AgentConversation"
SET "archivedAt" = CURRENT_TIMESTAMP
WHERE "archivedAt" IS NULL
  AND "projectId" IN (
    SELECT "Project"."id"
    FROM "Project"
    INNER JOIN "Chapter" ON "Chapter"."id" = "Project"."chapterId"
    WHERE "Chapter"."comicId" = 'comic-rainy-station'
  );

UPDATE "Chapter"
SET "archivedAt" = CURRENT_TIMESTAMP
WHERE "comicId" = 'comic-rainy-station'
  AND "archivedAt" IS NULL;

UPDATE "Comic"
SET "archivedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'comic-rainy-station'
  AND "archivedAt" IS NULL;
