import type { AssetSummary } from "@/packages/shared/src";

export type AssetKindName = AssetSummary["kind"];

const assetKindLabels: Record<AssetKindName, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  style: "风格",
  sketch: "草图",
  reference_image: "图片",
  generated_image: "图片",
};

const assetKindTags: Record<AssetKindName, string> = {
  character: "人",
  scene: "景",
  prop: "物",
  style: "风",
  sketch: "草",
  reference_image: "图",
  generated_image: "图",
};

export const assetKindLabel = (kind: AssetKindName) => assetKindLabels[kind];
export const assetKindTag = (kind: AssetKindName) => assetKindTags[kind];

export const isAssetVisibleInAssetSpace = (
  asset: Pick<AssetSummary, "kind" | "libraryStatus">,
) => asset.libraryStatus === "library"
  && asset.kind !== "generated_image";
