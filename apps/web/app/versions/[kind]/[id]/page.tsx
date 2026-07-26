import { notFound } from "next/navigation";
import { VersionCompareApp } from "@/app/components/VersionCompareApp";
import { uiCopy } from "@/app/lib/ui-copy";

export const metadata = { title: uiCopy.workbench.versions.compareTitle };

export default async function VersionComparisonPage({ params }: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (kind !== "saved_snapshot" && kind !== "change_proposal") notFound();
  return <VersionCompareApp targetKind={kind} targetId={id} />;
}

