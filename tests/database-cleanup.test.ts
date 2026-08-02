import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { clearComicData } from "../scripts/database-cleanup";
import { resetToCampusLetter } from "../scripts/reset-to-campus-letter";

function cleanupPrismaMock() {
  const operations: string[] = [];
  const argumentsByOperation = new Map<string, unknown>();
  const model = (name: string) => ({
    findMany: async () => [],
    deleteMany: (args?: unknown) => {
      const operation = `${name}.deleteMany`;
      operations.push(operation);
      argumentsByOperation.set(operation, args);
      return operation;
    },
    updateMany: (args?: unknown) => {
      const operation = `${name}.updateMany`;
      operations.push(operation);
      argumentsByOperation.set(operation, args);
      return operation;
    },
  });
  const prisma = {
    candidate: model("candidate"),
    agentActivityEvent: model("agentActivityEvent"),
    agentActivityGroup: model("agentActivityGroup"),
    artworkAnnotationWork: model("artworkAnnotationWork"),
    artworkAnnotationMessage: model("artworkAnnotationMessage"),
    artworkAnnotationAttachment: model("artworkAnnotationAttachment"),
    artworkAnnotationReference: model("artworkAnnotationReference"),
    artworkAnnotation: model("artworkAnnotation"),
    changeProposal: model("changeProposal"),
    agentDraftRevision: model("agentDraftRevision"),
    agentDraft: model("agentDraft"),
    generationAttempt: model("generationAttempt"),
    generationTask: model("generationTask"),
    messageReference: model("messageReference"),
    message: model("message"),
    agentConversation: model("agentConversation"),
    canvasReferencePlacement: model("canvasReferencePlacement"),
    canvasAssetListItem: model("canvasAssetListItem"),
    externalAssetUpload: model("externalAssetUpload"),
    assetImage: model("assetImage"),
    asset: model("asset"),
    assetVersion: model("assetVersion"),
    storyboardBeatVersion: model("storyboardBeatVersion"),
    storyboardBeat: model("storyboardBeat"),
    savedSnapshot: model("savedSnapshot"),
    workingRevision: model("workingRevision"),
    project: model("project"),
    chapter: model("chapter"),
    comicSetting: model("comicSetting"),
    comic: model("comic"),
    externalAgentOperation: model("externalAgentOperation"),
    user: model("user"),
    $transaction: async (items: unknown[]) => items,
  } as unknown as PrismaClient;
  return { prisma, operations, argumentsByOperation };
}

test("comic cleanup removes external uploads before their assets", async () => {
  const { prisma, operations, argumentsByOperation } = cleanupPrismaMock();
  await clearComicData(prisma, "comic-1");
  assert.ok(operations.indexOf("externalAssetUpload.deleteMany") < operations.indexOf("asset.deleteMany"));
  assert.ok(operations.indexOf("agentActivityEvent.deleteMany") < operations.indexOf("agentActivityGroup.deleteMany"));
  assert.ok(operations.indexOf("agentActivityGroup.deleteMany") < operations.indexOf("agentDraft.deleteMany"));
  assert.ok(operations.indexOf("artworkAnnotationWork.deleteMany") < operations.indexOf("changeProposal.deleteMany"));
  assert.ok(operations.indexOf("artworkAnnotationMessage.deleteMany") < operations.indexOf("artworkAnnotation.deleteMany"));
  assert.ok(operations.indexOf("artworkAnnotationAttachment.deleteMany") < operations.indexOf("artworkAnnotation.deleteMany"));
  assert.ok(operations.indexOf("artworkAnnotationReference.deleteMany") < operations.indexOf("artworkAnnotation.deleteMany"));
  assert.ok(operations.indexOf("artworkAnnotation.deleteMany") < operations.indexOf("project.deleteMany"));
  assert.ok(operations.indexOf("changeProposal.deleteMany") < operations.indexOf("agentDraftRevision.deleteMany"));
  assert.ok(operations.indexOf("agentDraftRevision.deleteMany") < operations.indexOf("agentDraft.deleteMany"));
  assert.ok(operations.indexOf("agentDraft.deleteMany") < operations.indexOf("project.deleteMany"));
  assert.ok(operations.indexOf("assetImage.deleteMany") < operations.indexOf("assetVersion.deleteMany"));
  assert.ok(operations.indexOf("assetVersion.deleteMany") < operations.indexOf("asset.deleteMany"));
  assert.deepEqual(argumentsByOperation.get("asset.deleteMany"), { where: { comicId: "comic-1" } });
  assert.deepEqual(argumentsByOperation.get("comic.deleteMany"), { where: { id: "comic-1" } });
  assert.equal(operations.includes("user.deleteMany"), false);
  assert.equal(operations.includes("externalAgentOperation.deleteMany"), false);
});

test("template reset delegates only to the scoped example seed", async () => {
  let seeded = 0;
  await resetToCampusLetter(async () => {
    seeded += 1;
  });
  assert.equal(seeded, 1);
});
