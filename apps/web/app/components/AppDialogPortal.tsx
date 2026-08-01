"use client";

import { type PropsWithChildren } from "react";
import { createPortal } from "react-dom";
import { useDocumentBody } from "@/app/lib/client-environment";

export function AppDialogPortal({ children }: PropsWithChildren) {
  const portalTarget = useDocumentBody();
  return portalTarget ? createPortal(children, portalTarget) : null;
}
