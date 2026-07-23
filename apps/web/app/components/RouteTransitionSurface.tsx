"use client";

import { type ComponentPropsWithoutRef } from "react";
import { useContentRouteEntryTransition } from "@/app/lib/content-route-transition";

export function RouteTransitionSurface({ className, ...props }: ComponentPropsWithoutRef<"main">) {
  const entryTransition = useContentRouteEntryTransition();
  return <main className={[className, "route-page-transition", entryTransition].filter(Boolean).join(" ")} {...props} />;
}
