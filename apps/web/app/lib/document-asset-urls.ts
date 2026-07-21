import type { ResolvedResourceMap } from "@lantern/shared";

/** URLs are a read model beside LCD v0.4, never persisted in the document. */
export function normalizeResolvedResourceUrls(resources: ResolvedResourceMap | undefined, apiBase: string): ResolvedResourceMap {
  return Object.fromEntries(Object.entries(resources ?? {}).map(([versionId, resolved]) => [versionId, {
    ...resolved,
    url: resolved.url.startsWith("/v1/") ? `${apiBase}${resolved.url}` : resolved.url,
  }]));
}
