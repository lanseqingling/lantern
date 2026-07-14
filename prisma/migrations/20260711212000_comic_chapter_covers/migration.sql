ALTER TABLE "Comic"
  ADD COLUMN "coverObjectKey" TEXT,
  ADD COLUMN "coverContentType" TEXT,
  ADD COLUMN "coverWidth" INTEGER,
  ADD COLUMN "coverHeight" INTEGER;

ALTER TABLE "Chapter"
  ADD COLUMN "coverObjectKey" TEXT,
  ADD COLUMN "coverContentType" TEXT,
  ADD COLUMN "coverWidth" INTEGER,
  ADD COLUMN "coverHeight" INTEGER;
