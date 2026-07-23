import type { AssetSummary } from "@lantern/shared";
import { uiCopy } from "./ui-copy";

export type AssetKindName = AssetSummary["kind"];

const assetKindLabels: Record<AssetKindName, string> = {
  character: uiCopy.asset.kind.character,
  scene: uiCopy.asset.kind.scene,
  prop: uiCopy.asset.kind.prop,
  style: uiCopy.asset.kind.style,
  sketch: uiCopy.asset.kind.sketch,
  reference_image: uiCopy.asset.kind.image,
  generated_image: uiCopy.asset.kind.image,
};

const assetKindTags: Record<AssetKindName, string> = {
  character: uiCopy.asset.kindTag.character,
  scene: uiCopy.asset.kindTag.scene,
  prop: uiCopy.asset.kindTag.prop,
  style: uiCopy.asset.kindTag.style,
  sketch: uiCopy.asset.kindTag.sketch,
  reference_image: uiCopy.workbench.object.image,
  generated_image: uiCopy.workbench.object.image,
};

export const assetKindLabel = (kind: AssetKindName) => assetKindLabels[kind];
export const assetKindTag = (kind: AssetKindName) => assetKindTags[kind];

export const isAssetVisibleInAssetSpace = (
  asset: Pick<AssetSummary, "kind" | "libraryStatus">,
) => asset.libraryStatus === "library"
  && asset.kind !== "generated_image";
