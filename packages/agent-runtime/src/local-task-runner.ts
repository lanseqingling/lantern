import { TaskStatus } from "@prisma/client";
import { prisma } from "@lantern/server/db";
import { processGenerationTask } from "./task-processor";

export type LocalTaskRunnerState = "stopped" | "recovering" | "running" | "stopping";

export class LocalTaskRunner {
  readonly concurrency: number;
  readonly pollIntervalMs: number;
  private state: LocalTaskRunnerState = "stopped";
  private readonly pending = new Set<string>();
  private readonly active = new Map<string, Promise<void>>();
  private timer?: NodeJS.Timeout;

  constructor(options: { concurrency?: number; pollIntervalMs?: number } = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.pollIntervalMs = options.pollIntervalMs ?? 750;
  }

  getState() {
    return { state: this.state, active: this.active.size, pending: this.pending.size, concurrency: this.concurrency };
  }

  async start() {
    if (this.state === "running" || this.state === "recovering") return;
    this.state = "recovering";
    await this.recoverInterruptedTasks();
    this.state = "running";
    await this.poll();
    this.timer = setInterval(() => void this.poll().catch(() => undefined), this.pollIntervalMs);
    this.timer.unref();
  }

  async stop() {
    if (this.state === "stopped") return;
    this.state = "stopping";
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.pending.clear();
    await Promise.allSettled(this.active.values());
    this.state = "stopped";
  }

  enqueue(taskId: string) {
    if (this.state !== "running") throw new Error("LOCAL_TASK_RUNNER_NOT_RUNNING");
    if (!this.active.has(taskId)) this.pending.add(taskId);
    this.drain();
  }

  private async recoverInterruptedTasks() {
    await prisma.$transaction(async (tx) => {
      await tx.generationAttempt.updateMany({
        where: { status: TaskStatus.RUNNING, task: { status: TaskStatus.RUNNING } },
        data: {
          status: TaskStatus.FAILED,
          errorCode: "runtime_interrupted",
          errorMessage: "本地服务在任务执行期间退出，任务已重新排队。",
          completedAt: new Date(),
        },
      });
      await tx.generationTask.updateMany({
        where: { status: TaskStatus.RUNNING },
        data: {
          status: TaskStatus.QUEUED,
          progress: 5,
          errorCode: null,
          errorMessage: null,
          completedAt: null,
        },
      });
      await tx.generationTask.updateMany({
        where: { status: TaskStatus.CREATED },
        data: { status: TaskStatus.QUEUED, progress: 5 },
      });
      await tx.generationTask.updateMany({
        where: { status: TaskStatus.CANCEL_REQUESTED },
        data: { status: TaskStatus.CANCELED, completedAt: new Date() },
      });
    });
  }

  private async poll() {
    if (this.state !== "running") return;
    const capacity = Math.max(0, this.concurrency - this.active.size - this.pending.size);
    if (capacity > 0) {
      const tasks = await prisma.generationTask.findMany({
        where: { status: TaskStatus.QUEUED },
        orderBy: { createdAt: "asc" },
        take: capacity,
        select: { id: true },
      });
      for (const task of tasks) if (!this.active.has(task.id)) this.pending.add(task.id);
    }
    this.drain();
  }

  private drain() {
    if (this.state !== "running") return;
    while (this.active.size < this.concurrency) {
      const taskId = this.pending.values().next().value as string | undefined;
      if (!taskId) break;
      this.pending.delete(taskId);
      const execution = processGenerationTask(taskId)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          this.active.delete(taskId);
          this.drain();
        });
      this.active.set(taskId, execution);
    }
  }
}

const globalForRunner = globalThis as unknown as { lanternLocalTaskRunner?: LocalTaskRunner };

export const localTaskRunner = globalForRunner.lanternLocalTaskRunner ?? new LocalTaskRunner();
if (process.env.APP_ENV !== "production") globalForRunner.lanternLocalTaskRunner = localTaskRunner;
