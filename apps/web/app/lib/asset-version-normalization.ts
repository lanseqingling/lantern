export type AssetVersionWithNullableDimensions = {
  id: string;
  version: number;
  contentUrl?: string;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
};

export function normalizeAssetVersionDimensions(version: AssetVersionWithNullableDimensions) {
  const { width, height, ...rest } = version;
  return {
    ...rest,
    ...(typeof width === "number" && width > 0 ? { width } : {}),
    ...(typeof height === "number" && height > 0 ? { height } : {}),
  };
}
