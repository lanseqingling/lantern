BEGIN;

-- Asset 的创作语义统一收敛到 description。技术来源字段已有各自事实源，
-- 不并入创作描述；其余历史属性按稳定标签一次性保留为自然语言。
WITH object_attribute_lines AS (
  SELECT
    asset.id,
    string_agg(
      concat(
        CASE entry.key
          WHEN 'identity' THEN '身份与外观'
          WHEN 'ageStage' THEN '年龄阶段'
          WHEN 'age' THEN '年龄'
          WHEN 'outfit' THEN '服装'
          WHEN 'personality' THEN '性格与神态'
          WHEN 'temperament' THEN '气质'
          WHEN 'currentState' THEN '当前状态'
          WHEN 'spatialLayout' THEN '空间布局'
          WHEN 'time' THEN '时间'
          WHEN 'weather' THEN '天气'
          WHEN 'lighting' THEN '光线'
          WHEN 'mood' THEN '氛围'
          WHEN 'linework' THEN '线条'
          WHEN 'tones' THEN '色调'
          WHEN 'state' THEN '状态'
          WHEN 'narrativeRole' THEN '叙事作用'
          WHEN 'style' THEN '风格'
          ELSE entry.key
        END,
        '：',
        btrim(entry.value)
      ),
      E'\n'
      ORDER BY
        CASE entry.key
          WHEN 'identity' THEN 10
          WHEN 'ageStage' THEN 20
          WHEN 'age' THEN 30
          WHEN 'outfit' THEN 40
          WHEN 'personality' THEN 50
          WHEN 'temperament' THEN 60
          WHEN 'currentState' THEN 70
          WHEN 'spatialLayout' THEN 80
          WHEN 'time' THEN 90
          WHEN 'weather' THEN 100
          WHEN 'lighting' THEN 110
          WHEN 'mood' THEN 120
          WHEN 'linework' THEN 130
          WHEN 'tones' THEN 140
          WHEN 'state' THEN 150
          WHEN 'narrativeRole' THEN 160
          WHEN 'style' THEN 170
          ELSE 1000
        END,
        entry.key
    ) AS lines
  FROM "Asset" AS asset
  CROSS JOIN LATERAL jsonb_each_text(
    CASE WHEN jsonb_typeof(asset."attributes") = 'object' THEN asset."attributes" ELSE '{}'::jsonb END
  ) AS entry(key, value)
  WHERE btrim(entry.value) <> ''
    AND lower(entry.key) NOT IN ('provider', 'model', 'page', 'readingorder', 'originalfilename')
    AND strpos(coalesce(asset."description", ''), btrim(entry.value)) = 0
  GROUP BY asset.id
),
non_object_attribute_lines AS (
  SELECT
    asset.id,
    CASE
      WHEN asset."attributes" IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb) THEN NULL
      WHEN jsonb_typeof(asset."attributes") <> 'object' THEN concat('补充信息：', asset."attributes"::text)
      ELSE NULL
    END AS lines
  FROM "Asset" AS asset
),
merged_descriptions AS (
  SELECT
    asset.id,
    btrim(concat_ws(
      E'\n\n',
      nullif(btrim(asset."description"), ''),
      nullif(btrim(coalesce(object_lines.lines, non_object_lines.lines, '')), '')
    )) AS description
  FROM "Asset" AS asset
  LEFT JOIN object_attribute_lines AS object_lines ON object_lines.id = asset.id
  LEFT JOIN non_object_attribute_lines AS non_object_lines ON non_object_lines.id = asset.id
)
UPDATE "Asset" AS asset
SET "description" = merged.description
FROM merged_descriptions AS merged
WHERE asset.id = merged.id;

-- 不截断历史数据。若合并后超出当前产品契约，阻止迁移并先人工整理。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Asset" WHERE length("description") > 4000) THEN
    RAISE EXCEPTION 'Asset description exceeds 4000 characters after attributes migration';
  END IF;
END
$$;

ALTER TABLE "Asset" DROP COLUMN "attributes";

COMMIT;
