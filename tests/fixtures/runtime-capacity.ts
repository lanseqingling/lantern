import type { ComicDocument, StoryboardBeat } from "@lantern/shared";

export function createCapacityFixture() {
  const storyboardBeats: StoryboardBeat[] = Array.from({ length: 120 }, (_, index) => ({
    id: `capacity-storyboardBeat-${index + 1}`,
    versionId: `capacity-storyboardBeat-${index + 1}-v1`,
    title: `容量分镜 ${index + 1}`,
    description: `${index % 3 === 0 ? "远景" : "中景"}推进故事，保持稳定连续的阅读动线。`,
  }));
  const document: ComicDocument = {
    protocolVersion: "lcd-0.4",
    comicId: "capacity-comic",
    chapterId: "capacity-chapter",
    format: "page",
    reading: { viewer: "paged", direction: "ltr", unitOrder: Array.from({ length: 24 }, (_, index) => `capacity-page-${index + 1}`), showPageNumber: true, gap: 24 },
    units: Array.from({ length: 24 }, (_, pageIndex) => ({
      id: `capacity-page-${pageIndex + 1}`,
      kind: "single_page" as const,
      pageRole: "story" as const,
      canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
      surfaces: [{ id: `capacity-page-${pageIndex + 1}-surface`, role: "single" as const, geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: pageIndex + 1 }],
      frames: storyboardBeats.slice(pageIndex * 5, pageIndex * 5 + 5).map((storyboardBeat, frameIndex) => ({
        id: `capacity-frame-${pageIndex + 1}-${frameIndex + 1}`,
        storyRefs: [{ storyboardBeatId: storyboardBeat.id, storyboardBeatVersionId: storyboardBeat.versionId, role: "primary" as const }],
        geometry: { x: 32, y: 32 + frameIndex * 202, width: 656, height: 190 },
        zIndex: 1,
        border: { color: "#111111", width: 3, style: "solid" as const },
        shape: { kind: "rect" as const },
        mask: { mode: "clip" as const },
        layers: [],
      })),
      overlayLayers: [],
      readingSequence: storyboardBeats.slice(pageIndex * 5, pageIndex * 5 + 5).map((_, frameIndex) => ({ frameId: `capacity-frame-${pageIndex + 1}-${frameIndex + 1}` })),
      layoutPolicy: { frameOverlap: "forbid" as const, defaultOverflow: "clip" as const },
    })),
    resources: Array.from({ length: 200 }, (_, index) => ({
      assetId: `capacity-asset-${index + 1}`,
      assetVersionId: `capacity-asset-${index + 1}-v1`,
      kind: "image" as const,
      width: 1024,
      height: 1024,
      mediaType: "image/webp",
    })),
    dialogues: [],
  };
  const messages = Array.from({ length: 300 }, (_, index) => ({
    id: `capacity-message-${index + 1}`,
    role: index % 2 === 0 ? "user" as const : "agent" as const,
    content: `容量会话消息 ${index + 1}`,
  }));
  return { document, storyboardBeats, messages };
}
