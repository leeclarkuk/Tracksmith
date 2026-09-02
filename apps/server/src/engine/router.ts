import { nanoid } from 'nanoid';
import {
  buildAutopilotPrompt,
  buildTaskSpec,
  resolveEngine,
  type OutcomeCard,
  type ResolvedEngine,
} from '@tracksmith/shared';
import type { CardStore } from '../db/store.js';
import type { GatewayClient } from '../gateway/client.js';
import type { PendingRunRegistry } from '../pending-runs.js';
import { Projector } from '../gateway/projector.js';
import { settleWithGoalContract, tryRunGoalRetry } from '../goal-eval.js';

export class EngineRouter {
  constructor(
    private store: CardStore,
    private gateway: GatewayClient,
    private gatewayUrl: string,
    private pending: PendingRunRegistry,
  ) {}

  async run(card: OutcomeCard): Promise<OutcomeCard> {
    return this.store.mutate(card.id, async (current) => {
      if (current.column !== 'todo' && current.column !== 'backlog') {
        throw new Error('Card must be in todo or backlog to run');
      }

      const resolved: ResolvedEngine = resolveEngine(current.engine, current.prompt);
      current.resolvedEngine = resolved;
      current.audit.push({
        id: nanoid(),
        at: new Date().toISOString(),
        kind: 'engine_resolved',
        message: `Resolved engine: ${resolved}`,
      });

      if (resolved === 'task_runner') {
        const status = await this.gateway.getStatus();
        if (!status.taskRunnerEnabled) {
          current.failureReason = 'Task Runner is not enabled on the Host. Enable it in KiroCrew, then retry.';
          current.audit.push({
            id: nanoid(),
            at: new Date().toISOString(),
            kind: 'run_started',
            message: 'Run blocked: Task Runner unavailable',
          });
          return current;
        }
      }

      if (current.goalContract?.continueUntilVerified) {
        current.goalContract.startedAt = current.goalContract.startedAt ?? new Date().toISOString();
        current.goalContract.attemptStartedAt = new Date().toISOString();
      }

      current.failureReason = undefined;
      current.settledAt = undefined;
      current.audit.push({
        id: nanoid(),
        at: new Date().toISOString(),
        kind: 'run_started',
        message: `Dispatching via ${resolved}`,
      });

      this.pending.start(current.id, resolved === 'task_runner' ? 'task_runner' : 'chat');

      let runRef: OutcomeCard['runRef'];
      try {
        if (resolved === 'task_runner') {
          const spec = buildTaskSpec(current.prompt, current.goalContract);
          const run = await this.gateway.startTaskRunner(spec);
          runRef = { kind: 'task_runner', taskId: run.task_id, sessionKey: `taskrunner:${run.task_id}` };
          this.pending.attachTask(current.id, run.task_id);
        } else {
          const slot = await this.gateway.createSlot(`tracksmith-${current.id.slice(0, 8)}`);
          this.pending.attachSlot(current.id, slot.id);
          const message = resolved === 'autopilot' ? buildAutopilotPrompt(current.prompt) : current.prompt;
          await this.gateway.sendMessage(slot.id, message);
          runRef = { kind: 'chat', slotId: slot.id, sessionKey: slot.id };
        }
      } catch (err) {
        this.pending.clear(current.id);
        current.column = 'failed';
        current.failureReason = err instanceof Error ? err.message : 'Run dispatch failed';
        current.settledAt = new Date().toISOString();
        current.audit.push({
          id: nanoid(),
          at: new Date().toISOString(),
          kind: 'settled',
          message: current.failureReason,
        });
        return current;
      }

      current.column = 'running';
      current.runRef = runRef;
      if (current.goalContract?.continueUntilVerified) {
        current.goalContract.attemptCount += 1;
      }
      return current;
    }).then(async (updated) => {
      if (!updated?.runRef?.taskId) return updated;
      const needsFastSettle =
        this.pending.consumeCompletedTask(updated.runRef.taskId) ||
        (await this.isTaskAlreadyTerminal(updated.runRef.taskId));
      if (!needsFastSettle) return updated;
      const settled = await this.store.mutate(updated.id, async (card) => {
        const taskId = card.runRef?.taskId;
        if (card.column !== 'running' || !taskId || taskId !== updated.runRef?.taskId) return null;
        const runResult = await this.gateway.getTaskRunResult(taskId);
        if (runResult.status !== 'ok' || !runResult.data) return card;
        const run = runResult.data;
        let next: OutcomeCard;
        if (card.goalContract?.continueUntilVerified) {
          next = (await settleWithGoalContract(card, run, new Projector(this.gateway))) ?? card;
        } else {
          next = (await new Projector(this.gateway).settleTask(card, run)) ?? card;
        }
        if (next.column !== 'running') {
          this.pending.clear(next.id);
        }
        return next;
      });
      return settled ?? updated;
    }).then(async (result) => {
      if (!result) return result;
      return (await tryRunGoalRetry(this, result)) ?? result;
    }) as Promise<OutcomeCard>;
  }

  private async isTaskAlreadyTerminal(taskId: string): Promise<boolean> {
    const runResult = await this.gateway.getTaskRunResult(taskId);
    if (runResult.status !== 'ok' || !runResult.data) return false;
    const status = runResult.data.status;
    return status === 'completed' || status === 'done' || status === 'failed' || status === 'cancelled';
  }

  async correct(card: OutcomeCard, instruction: string): Promise<OutcomeCard> {
    let redispatch = false;
    return this.store.mutate(card.id, async (current) => {
      if (current.column === 'running') {
        throw new Error('Cannot correct while agent is working');
      }
      current.audit.push({
        id: nanoid(),
        at: new Date().toISOString(),
        kind: 'correction',
        message: instruction.slice(0, 200),
      });

      if (current.runRef?.kind === 'chat' && current.runRef.slotId) {
        current.column = 'running';
        if (current.goalContract?.continueUntilVerified) {
          current.goalContract.attemptStartedAt = new Date().toISOString();
        }
        try {
          await this.gateway.sendMessage(current.runRef.slotId, instruction);
        } catch (err) {
          current.column = current.settledAt ? (current.failureReason ? 'failed' : 'done') : 'todo';
          throw err;
        }
        return current;
      }

      if (current.runRef?.kind === 'task_runner' && current.runRef.taskId) {
        try {
          const chat = await this.gateway.taskToChat(current.runRef.taskId);
          if (chat.slotId) {
            current.runRef = { kind: 'chat', slotId: chat.slotId, sessionKey: chat.slotId };
            current.column = 'running';
            await this.gateway.sendMessage(chat.slotId, instruction);
            return current;
          }
          const followUp = 'Open follow-up chat in Host to continue with your correction';
          if (current.resultPacket) {
            if (!current.resultPacket.nextActions.includes(followUp)) {
              current.resultPacket.nextActions = [...current.resultPacket.nextActions, followUp];
            }
          } else {
            current.resultPacket = {
              finalSummary: 'Follow-up chat opened in Host',
              checks: [],
              artifacts: [],
              risks: [],
              nextActions: [followUp],
              producedAt: new Date().toISOString(),
            };
          }
          current.audit.push({
            id: nanoid(),
            at: new Date().toISOString(),
            kind: 'correction',
            message: 'Task-to-chat returned no slot id; preserved existing result packet',
          });
          return current;
        } catch {
          current.prompt = `${current.prompt}\n\nCorrection: ${instruction}`;
          if (current.column === 'todo') {
            redispatch = true;
          } else {
            const retryHint = 'Correction could not reach the Host; move to To Do and press Run to retry';
            if (current.resultPacket && !current.resultPacket.nextActions.includes(retryHint)) {
              current.resultPacket.nextActions = [...current.resultPacket.nextActions, retryHint];
            }
          }
        }
      } else {
        current.prompt = `${current.prompt}\n\nCorrection: ${instruction}`;
        if (current.column === 'todo') {
          redispatch = true;
        }
      }

      return current;
    }).then(async (updated) => {
      if (redispatch && updated) {
        return this.run(updated);
      }
      return updated ?? card;
    });
  }

  hostUrl(card: OutcomeCard): string {
    const engine = card.resolvedEngine ?? resolveEngine(card.engine, card.prompt);
    if (engine === 'task_runner' && card.runRef?.taskId) {
      return this.gateway.tasksUrl(card.runRef.taskId);
    }
    if (card.runRef?.slotId) {
      return this.gateway.chatUrl(card.runRef.slotId);
    }
    return engine === 'task_runner' ? this.gateway.tasksUrl() : this.gatewayUrl;
  }
}
