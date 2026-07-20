import { z } from "zod";
import { comicDocumentSchema } from "./lcd/schema";
import { storyboardBeatSchema } from "./workspace-schema";

export const chapterArchiveFileNames = {
  manifest: "manifest.json",
  lcd: "lcd.json",
  storyboardBeats: "storyboard-beats.json",
} as const;

const assetKindSchema = z.enum(["character", "scene", "style", "prop", "reference_image", "sketch", "generated_image"]);

export const chapterArchiveAssetSchema = z.strictObject({
  assetId: z.string().min(1),
  kind: assetKindSchema,
  name: z.string().min(1).max(160),
  description: z.string().max(4000),
});

export const chapterArchiveResourceSchema = z.strictObject({
  assetId: z.string().min(1),
  assetVersionId: z.string().min(1),
  path: z.string().regex(/^resources\/[a-zA-Z0-9._-]+\.(png|jpg|webp)$/),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const chapterArchiveManifestSchema = z.strictObject({
  protocol: z.literal("lantern-chapter-archive-1"),
  createdAt: z.string().datetime(),
  source: z.strictObject({
    comicId: z.string().min(1),
    chapterId: z.string().min(1),
  }),
  files: z.strictObject({
    lcd: z.literal(chapterArchiveFileNames.lcd),
    storyboardBeats: z.literal(chapterArchiveFileNames.storyboardBeats),
  }),
  assets: z.array(chapterArchiveAssetSchema),
  resources: z.array(chapterArchiveResourceSchema),
});

export const chapterArchiveLcdSchema = comicDocumentSchema;
export const chapterArchiveStoryboardBeatsSchema = z.array(storyboardBeatSchema).max(120);

export type ChapterArchiveManifest = z.infer<typeof chapterArchiveManifestSchema>;
export type ChapterArchiveAsset = z.infer<typeof chapterArchiveAssetSchema>;
export type ChapterArchiveResource = z.infer<typeof chapterArchiveResourceSchema>;
