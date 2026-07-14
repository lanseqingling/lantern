-- P0-A's four demo panels were previously used as a fallback for every unknown
-- storyboard panel. They belong exclusively to the seeded demo comic. Remove
-- those leaked images from other comics while preserving frames, balloons and
-- all real uploaded/generated assets.

UPDATE "WorkingRevision" AS wr
SET document = jsonb_set(
  jsonb_set(
    wr.document,
    '{assets}',
    COALESCE((
      SELECT jsonb_agg(asset)
      FROM jsonb_array_elements(wr.document->'assets') AS asset
      WHERE asset->>'assetVersionId' NOT IN (
        'asset-panel-01-classroom-v1',
        'asset-panel-02-turn-v1',
        'asset-panel-03-letter-v1',
        'asset-panel-04-hair-v1'
      )
    ), '[]'::jsonb)
  ),
  '{pages}',
  COALESCE((
    SELECT jsonb_agg(
      jsonb_set(
        page,
        '{elements}',
        COALESCE((
          SELECT jsonb_agg(element)
          FROM jsonb_array_elements(page->'elements') AS element
          WHERE NOT (
            element->>'type' = 'image'
            AND element->>'assetVersionId' IN (
              'asset-panel-01-classroom-v1',
              'asset-panel-02-turn-v1',
              'asset-panel-03-letter-v1',
              'asset-panel-04-hair-v1'
            )
          )
        ), '[]'::jsonb)
      )
    )
    FROM jsonb_array_elements(wr.document->'pages') AS page
  ), '[]'::jsonb)
)
FROM "Project" AS project
JOIN "Chapter" AS chapter ON chapter.id = project."chapterId"
WHERE wr."projectId" = project.id
  AND chapter."comicId" <> 'comic-after-school';

UPDATE "SavedSnapshot" AS snapshot
SET document = jsonb_set(
  jsonb_set(
    snapshot.document,
    '{assets}',
    COALESCE((
      SELECT jsonb_agg(asset)
      FROM jsonb_array_elements(snapshot.document->'assets') AS asset
      WHERE asset->>'assetVersionId' NOT IN (
        'asset-panel-01-classroom-v1',
        'asset-panel-02-turn-v1',
        'asset-panel-03-letter-v1',
        'asset-panel-04-hair-v1'
      )
    ), '[]'::jsonb)
  ),
  '{pages}',
  COALESCE((
    SELECT jsonb_agg(
      jsonb_set(
        page,
        '{elements}',
        COALESCE((
          SELECT jsonb_agg(element)
          FROM jsonb_array_elements(page->'elements') AS element
          WHERE NOT (
            element->>'type' = 'image'
            AND element->>'assetVersionId' IN (
              'asset-panel-01-classroom-v1',
              'asset-panel-02-turn-v1',
              'asset-panel-03-letter-v1',
              'asset-panel-04-hair-v1'
            )
          )
        ), '[]'::jsonb)
      )
    )
    FROM jsonb_array_elements(snapshot.document->'pages') AS page
  ), '[]'::jsonb)
)
FROM "Chapter" AS chapter
WHERE snapshot."chapterId" = chapter.id
  AND chapter."comicId" <> 'comic-after-school';
