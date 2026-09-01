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

export class EngineRouter {
  constructor(
    private store: CardStore,
    private gateway: GatewayClient,
    private gatewayUrl: string,
  ) {}

  async run(card: OutcomeCard): Promise<OutcomeCard> {
    if (card.column !== 'todo' && card.column !== 'backlog') {
      throw new Error('Card must be in todo or backlog to run');
    }

    const resolved: ResolvedEngine = resolveEngine(card.engine, card.prompt);
    card.resolvedEngine = resolved;
    card.audit.push({ id: nanoid(), at: new Date().toISOString(), kind: 'engine_resolved', message: `Resolved engine: ${resolved}` });

    if (resolved === 'task_runner') {
      const status = await this.gateway.getStatus();
      if (!status.taskRunnerEnabled) {
        card.failureReason = 'Task Runner is not enabled on the Host. Enable it in KiroCrew, then retry.';
        card.audit.push({ id: nanoid(), at: new Date().toISOString(), kind: 'run_started', message: 'Run blocked: Task Runner unavailable' });
        return this.store.save(card);
      }
    }

    card.column = 'running';
    card.failureReason = undefined;
    card.settledAt = undefined;
    if (card.goalContract) {
      card.goalContract.attemptCount += 1;
      card.goalContract.startedAt = card.goalContract.startedAt ?? new Date().toISOString();
    }
    card.audit.push({ id: nanoid(), at: new Date().toISOString(), kind: 'run_started', message: `Started via ${resolved}` });
    this.store.save(card);

    try {
      if (resolved === 'task_runner') {
        const spec = buildTaskSpec(card.prompt, card.goalContract);
        const run = await this.gateway.startTaskRunner(spec);
        card.runRef = { kind: 'task_runner', taskId: run.task_id, sessionKey: `taskrunner:${run.task_id}` };
      } else {
        const slot = await this.gateway.createSlot(`tracksmith-${card.id.slice(0, 8)}`);
        const message = resolved === 'autopilot' ? buildAutopilotPrompt(card.prompt) : card.prompt;
        await this.gateway.sendMessage(slot.id, message);
        card.runRef = { kind: 'chat', slotId: slot.id, sessionKey: slot.id };
      }
    } catch (err) {
      card.column = 'failed';
      card.failureReason = err instanceof Error ? err.message : 'Run dispatch failed';
      card.settledAt = new Date().toISOString();
      card.audit.push({ id: nanoid(), at: new Date().toISOString(), kind: 'settled', message: card.failureReason });
    }

    return this.store.save(card);
  }

  async correct(card: OutcomeCard, instruction: string): Promise<OutcomeCard> {
    if (card.column === 'running') {
      throw new Error('Cannot correct while agent is working');
    }

    card.audit.push({ id: nanoid(), at: new Date().toISOString(), kind: 'correction', message: instruction.slice(0, 200) });
    this.store.save(card);

    if (card.runRef?.kind === 'chat' && card.runRef.slotId) {
      card.column = 'running';
      this.store.save(card);
      try {
        await this.gateway.sendMessage(card.runRef.slotId, instruction);
      } catch (err) {
        card.column = card.settledAt ? (card.failureReason ? 'failed' : 'done') : 'todo';
        this.store.save(card);
        throw err;
      }
      return card;
    }

    if (card.runRef?.kind === 'task_runner' && card.runRef.taskId) {
      try {
        await this.gateway.taskToChat(card.runRef.taskId);
        card.resultPacket = {
          finalSummary: 'Follow-up chat opened in Host',
          checks: [],
          artifacts: [],
          risks: [],
          nextActions: ['Open follow-up chat in Host to continue with your correction'],
          producedAt: new Date().toISOString(),
        };
      } catch {
        card.column = 'todo';
        card.prompt = `${card.prompt}\n\nCorrection: ${instruction}`;
        return this.run(card);
      }
    } else {
      card.column = 'todo';
      card.prompt = `${card.prompt}\n\nCorrection: ${instruction}`;
      return this.run(card);
    }

    return this.store.save(card);
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
