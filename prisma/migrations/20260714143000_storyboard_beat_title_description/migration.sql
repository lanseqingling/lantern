-- StoryboardBeat is a general frame narrative record. Character action,
-- emotion and camera-specific fields are folded into its free description;
-- dialogue remains an independent LCD Dialogue object.
ALTER TABLE "StoryboardBeatVersion" ADD COLUMN "title" TEXT;
ALTER TABLE "StoryboardBeatVersion" ADD COLUMN "description" TEXT;

UPDATE "StoryboardBeatVersion"
SET
  "title" = COALESCE(NULLIF(BTRIM("storyPurpose"), ''), '未命名单格'),
  "description" = CONCAT_WS('；',
    CASE WHEN NULLIF(BTRIM("shotType"), '') IS NOT NULL THEN '镜头：' || BTRIM("shotType") END,
    CASE WHEN NULLIF(BTRIM("composition"), '') IS NOT NULL THEN '构图：' || BTRIM("composition") END,
    CASE WHEN NULLIF(BTRIM("action"), '') IS NOT NULL THEN '画面：' || BTRIM("action") END,
    CASE WHEN NULLIF(BTRIM("emotion"), '') IS NOT NULL THEN '氛围：' || BTRIM("emotion") END
  );

ALTER TABLE "StoryboardBeatVersion" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "StoryboardBeatVersion" ALTER COLUMN "description" SET NOT NULL;

UPDATE "WorkingRevision" AS revision
SET "storyboardBeats" = COALESCE((
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'id', beat->>'id',
    'versionId', beat->>'versionId',
    'title', COALESCE(NULLIF(BTRIM(beat->>'title'), ''), NULLIF(BTRIM(beat->>'storyPurpose'), ''), '未命名单格'),
    'description', COALESCE(NULLIF(BTRIM(beat->>'description'), ''), CONCAT_WS('；',
      CASE WHEN NULLIF(BTRIM(beat->>'shotType'), '') IS NOT NULL THEN '镜头：' || BTRIM(beat->>'shotType') END,
      CASE WHEN NULLIF(BTRIM(beat->>'composition'), '') IS NOT NULL THEN '构图：' || BTRIM(beat->>'composition') END,
      CASE WHEN NULLIF(BTRIM(beat->>'action'), '') IS NOT NULL THEN '画面：' || BTRIM(beat->>'action') END,
      CASE WHEN NULLIF(BTRIM(beat->>'emotion'), '') IS NOT NULL THEN '氛围：' || BTRIM(beat->>'emotion') END
    ))
  ) ORDER BY beat_index)
  FROM JSONB_ARRAY_ELEMENTS(revision."storyboardBeats") WITH ORDINALITY AS items(beat, beat_index)
), '[]'::JSONB)
WHERE JSONB_TYPEOF(revision."storyboardBeats") = 'array';

ALTER TABLE "StoryboardBeatVersion"
  DROP COLUMN "storyPurpose",
  DROP COLUMN "shotType",
  DROP COLUMN "cameraAngle",
  DROP COLUMN "composition",
  DROP COLUMN "characterIds",
  DROP COLUMN "sceneId",
  DROP COLUMN "action",
  DROP COLUMN "emotion",
  DROP COLUMN "dialogue",
  DROP COLUMN "continuityHints";
