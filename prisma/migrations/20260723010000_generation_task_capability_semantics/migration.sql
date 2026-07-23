UPDATE "GenerationTask"
SET "capabilityId" = CASE
    WHEN "type" = 'STORYBOARD' AND "scope" = 'selected_comic_frame' THEN 'storyboard.edit_single_entry'
    WHEN "type" = 'STORYBOARD' THEN 'storyboard.compose'
    WHEN "type" = 'PAGE_LAYOUT' THEN 'page_layout.generate'
    WHEN "type" = 'FRAME_IMAGE_GENERATE' AND "scope" = 'selected_comic_frame' THEN 'frame_image.generate_or_replace'
    WHEN "type" = 'FRAME_IMAGE_GENERATE' THEN 'frame_image.generate_batch'
    WHEN "type" = 'FRAME_IMAGE_REFINE' THEN 'frame_image.refine'
    WHEN "type" = 'ASSET_IMAGE_GENERATE' THEN 'asset.generate_character_or_scene'
    WHEN "type" = 'DIALOGUE' THEN 'dialogue.generate'
    WHEN "type" = 'EXPORT' THEN 'chapter.export'
    ELSE "capabilityId"
END
WHERE json_extract("input", '$.capability.id') IS NULL;
