CREATE OR REPLACE FUNCTION pg_temp.normalize_lcd_balloon_shapes(input jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE jsonb_typeof(input)
    WHEN 'object' THEN COALESCE((
      SELECT jsonb_object_agg(
        entry.key,
        CASE
          WHEN entry.key = 'shape' AND entry.value IN ('"whisper"'::jsonb, '"shout"'::jsonb)
            THEN '"normal"'::jsonb
          ELSE pg_temp.normalize_lcd_balloon_shapes(entry.value)
        END
      )
      FROM jsonb_each(input) AS entry
    ), '{}'::jsonb)
    WHEN 'array' THEN COALESCE((
      SELECT jsonb_agg(pg_temp.normalize_lcd_balloon_shapes(item.value) ORDER BY item.ordinality)
      FROM jsonb_array_elements(input) WITH ORDINALITY AS item(value, ordinality)
    ), '[]'::jsonb)
    ELSE input
  END
$$;

UPDATE "WorkingRevision"
SET "document" = pg_temp.normalize_lcd_balloon_shapes("document")
WHERE "document"::text LIKE '%"shape": "whisper"%'
   OR "document"::text LIKE '%"shape": "shout"%';

UPDATE "WorkingRevision"
SET "changeSet" = pg_temp.normalize_lcd_balloon_shapes("changeSet")
WHERE "changeSet" IS NOT NULL
  AND ("changeSet"::text LIKE '%"shape": "whisper"%'
    OR "changeSet"::text LIKE '%"shape": "shout"%');

UPDATE "SavedSnapshot"
SET "document" = pg_temp.normalize_lcd_balloon_shapes("document")
WHERE "document"::text LIKE '%"shape": "whisper"%'
   OR "document"::text LIKE '%"shape": "shout"%';

UPDATE "Candidate"
SET "payload" = pg_temp.normalize_lcd_balloon_shapes("payload"),
    "operations" = pg_temp.normalize_lcd_balloon_shapes("operations")
WHERE "payload"::text LIKE '%"shape": "whisper"%'
   OR "payload"::text LIKE '%"shape": "shout"%'
   OR "operations"::text LIKE '%"shape": "whisper"%'
   OR "operations"::text LIKE '%"shape": "shout"%';

UPDATE "PageVariant"
SET "scope" = pg_temp.normalize_lcd_balloon_shapes("scope"),
    "commands" = pg_temp.normalize_lcd_balloon_shapes("commands")
WHERE "scope"::text LIKE '%"shape": "whisper"%'
   OR "scope"::text LIKE '%"shape": "shout"%'
   OR "commands"::text LIKE '%"shape": "whisper"%'
   OR "commands"::text LIKE '%"shape": "shout"%';
