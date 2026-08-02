"use client";

import { useCallback, useEffect, useState } from "react";
import type { ArtworkAnnotation, ArtworkAnnotationAnchor, ArtworkAnnotationAttachmentInput } from "@lantern/shared";
import {
  apiCreateArtworkAnnotation,
  apiDeleteArtworkAnnotation,
  apiListArtworkAnnotations,
  apiUpdateArtworkAnnotation,
} from "@/app/lib/api-client";

export function useArtworkAnnotations(projectId: string | undefined, workingRevision: number) {
  const [annotations, setAnnotations] = useState<ArtworkAnnotation[]>([]);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!projectId) {
      setAnnotations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await apiListArtworkAnnotations(projectId, { limit: 200 });
      setAnnotations(result.annotations);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "UNKNOWN");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // The hook is the owner of this remote collection; a project or working
    // revision change invalidates the previous snapshot and starts a reload.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, workingRevision]);

  const create = useCallback(async (input: { content: string; references: ArtworkAnnotationAnchor[]; attachments: ArtworkAnnotationAttachmentInput[] }) => {
    if (!projectId) throw new Error("PROJECT_UNAVAILABLE");
    const created = await apiCreateArtworkAnnotation(projectId, {
      expectedWorkingRevision: workingRevision,
      ...input,
    });
    setAnnotations((current) => [created, ...current.filter((annotation) => annotation.id !== created.id)]);
    return created;
  }, [projectId, workingRevision]);

  const update = useCallback(async (
    annotation: ArtworkAnnotation,
    input: { content?: string; action?: "resolve" | "reopen" | "dismiss"; references?: ArtworkAnnotationAnchor[]; attachments?: ArtworkAnnotationAttachmentInput[] },
  ) => {
    const updated = await apiUpdateArtworkAnnotation(annotation.id, { expectedVersion: annotation.version, ...input });
    setAnnotations((current) => current.map((item) => item.id === updated.id ? updated : item));
    return updated;
  }, []);

  const remove = useCallback(async (annotation: ArtworkAnnotation) => {
    await apiDeleteArtworkAnnotation(annotation.id);
    setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
  }, []);

  return { annotations, loading, error, refresh, create, update, remove };
}
