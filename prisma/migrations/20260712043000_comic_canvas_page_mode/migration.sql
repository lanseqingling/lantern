CREATE TYPE "CanvasPageMode" AS ENUM ('SINGLE', 'SPREAD');

ALTER TABLE "Comic"
  ADD COLUMN "canvasPageMode" "CanvasPageMode" NOT NULL DEFAULT 'SINGLE';
