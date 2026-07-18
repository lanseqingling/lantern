import type { AssetSummary, ComicPage, ImageElement, ReferencePlacement, ResolvedResourceMap, ResourceBinding } from "@/packages/shared/src";

export type FrameImageChoice = {
  id: string;
  assetId: string;
  assetVersionId: string;
  label: string;
  url?: string;
  mediaType: string;
  width?: number;
  height?: number;
  source:
    | { kind: "page"; unitId: string; layerId: string; elementId: string }
    | { kind: "canvas"; placementId: string }
    | { kind: "asset" };
};

const resourceKey = (assetId: string, assetVersionId: string) => `${assetId}:${assetVersionId}`;

function mediaTypeForUrl(url?: string) {
  if (url?.toLowerCase().includes(".webp")) return "image/webp";
  if (url?.toLowerCase().match(/\.jpe?g(?:\?|$)/)) return "image/jpeg";
  return "image/png";
}

function pageImageKind(image: ImageElement) {
  if (image.location.space !== "overlay") return "纸面图";
  if (image.location.purpose === "cross_page") return "跨页图";
  if (image.location.purpose === "cross_segment") return "跨段图";
  return "纸面图";
}

export function buildFrameImageChoices(input: {
  assets: AssetSummary[];
  canvasImages: ReferencePlacement[];
  resources: ResourceBinding[];
  resolvedResources?: ResolvedResourceMap;
  currentPage?: ComicPage;
  includeCurrentPageImages: boolean;
}): FrameImageChoice[] {
  const resources = new Map(input.resources.map((resource) => [resourceKey(resource.assetId, resource.assetVersionId), resource]));
  const kindCounts = new Map<string, number>();
  const pageChoices = input.includeCurrentPageImages
    ? (input.currentPage?.elements ?? []).flatMap((element): FrameImageChoice[] => {
      if (element.type !== "image" || element.location.space !== "overlay" || element.location.anchor.type !== "unit") return [];
      const resource = resources.get(resourceKey(element.assetId, element.assetVersionId));
      if (!resource || resource.kind !== "image") return [];
      const kind = pageImageKind(element);
      const order = (kindCounts.get(kind) ?? 0) + 1;
      kindCounts.set(kind, order);
      return [{
        id: `page:${element.id}`,
        assetId: element.assetId,
        assetVersionId: element.assetVersionId,
        label: `当前页 · ${kind} ${String(order).padStart(2, "0")}`,
        url: input.resolvedResources?.[element.assetVersionId]?.url,
        mediaType: resource.mediaType,
        width: resource.width,
        height: resource.height,
        source: { kind: "page", unitId: input.currentPage!.id, layerId: element.layerId, elementId: element.id },
      }];
    })
    : [];

  const canvasChoices = input.canvasImages.flatMap((placement): FrameImageChoice[] => {
    const asset = input.assets.find((candidate) => candidate.id === placement.assetId || candidate.id === placement.localAssetId);
    const assetId = placement.assetId ?? asset?.id;
    const assetVersionId = placement.assetVersionId ?? asset?.versionId ?? asset?.versions?.[0]?.id;
    if (!assetId || !assetVersionId) return [];
    const version = asset?.versions?.find((candidate) => candidate.id === assetVersionId);
    return [{
      id: `canvas:${placement.id}`,
      assetId,
      assetVersionId,
      label: `画布 · ${placement.name}`,
      url: placement.imageSrc || asset?.contentUrl || version?.contentUrl,
      mediaType: mediaTypeForUrl(placement.imageSrc || asset?.contentUrl || version?.contentUrl),
      width: version?.width,
      height: version?.height,
      source: { kind: "canvas", placementId: placement.id },
    }];
  });

  const assetChoices = input.assets.filter((asset) => asset.kind === "reference_image").flatMap((asset): FrameImageChoice[] => {
    if (asset.images?.length) return asset.images.map((image) => {
      const version = asset.versions?.find((candidate) => candidate.id === image.versionId);
      const url = image.contentUrl ?? version?.contentUrl;
      return {
        id: `asset:${asset.id}:${image.id}`,
        assetId: asset.id,
        assetVersionId: image.versionId,
        label: `${asset.name} · ${image.label}`,
        url,
        mediaType: mediaTypeForUrl(url),
        width: version?.width,
        height: version?.height,
        source: { kind: "asset" },
      };
    });
    const version = asset.versions?.[0];
    const assetVersionId = asset.versionId ?? version?.id;
    const url = asset.contentUrl ?? version?.contentUrl;
    return assetVersionId ? [{
      id: `asset:${asset.id}:${assetVersionId}`,
      assetId: asset.id,
      assetVersionId,
      label: asset.name,
      url,
      mediaType: mediaTypeForUrl(url),
      width: version?.width,
      height: version?.height,
      source: { kind: "asset" },
    }] : [];
  });

  return [...pageChoices, ...canvasChoices, ...assetChoices];
}
