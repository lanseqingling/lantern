import { VersionCompareApp } from "@/app/components/VersionCompareApp";
import { uiCopy } from "@/app/lib/ui-copy";

export const metadata = { title: uiCopy.workbench.versions.compareTitle };

export default async function ChangeProposalReviewPage({ params }: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  return <VersionCompareApp targetKind="change_proposal" targetId={proposalId} />;
}

