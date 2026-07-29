import type { PrismaClient } from "@prisma/client";

export async function clearComicData(prisma: PrismaClient, comicId: string) {
  const projectIds = (await prisma.project.findMany({
    where: { chapter: { comicId } },
    select: { id: true },
  })).map((item) => item.id);
  const taskIds = (await prisma.generationTask.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true },
  })).map((item) => item.id);
  const messageIds = (await prisma.message.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true },
  })).map((item) => item.id);

  await prisma.$transaction([
    prisma.candidate.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.agentActivityEvent.deleteMany({ where: { group: { projectId: { in: projectIds } } } }),
    prisma.agentActivityGroup.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.changeProposal.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.agentDraftRevision.deleteMany({ where: { agentDraft: { projectId: { in: projectIds } } } }),
    prisma.agentDraft.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.generationAttempt.deleteMany({ where: { taskId: { in: taskIds } } }),
    prisma.generationTask.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.messageReference.deleteMany({ where: { messageId: { in: messageIds } } }),
    prisma.message.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.agentConversation.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.canvasReferencePlacement.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.canvasAssetListItem.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.externalAssetUpload.deleteMany({ where: { asset: { comicId } } }),
    prisma.assetImage.deleteMany({ where: { asset: { comicId } } }),
    prisma.asset.updateMany({ where: { comicId }, data: { variantOfAssetId: null } }),
    prisma.assetVersion.deleteMany({ where: { asset: { comicId } } }),
    prisma.asset.deleteMany({ where: { comicId } }),
    prisma.storyboardBeatVersion.deleteMany({ where: { storyboardBeat: { projectId: { in: projectIds } } } }),
    prisma.storyboardBeat.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.savedSnapshot.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.workingRevision.deleteMany({ where: { projectId: { in: projectIds } } }),
    prisma.project.deleteMany({ where: { id: { in: projectIds } } }),
    prisma.chapter.deleteMany({ where: { comicId } }),
    prisma.comicSetting.deleteMany({ where: { comicId } }),
    prisma.comic.deleteMany({ where: { id: comicId } }),
  ]);
}
