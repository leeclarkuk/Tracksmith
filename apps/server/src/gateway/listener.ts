import type { OutcomeCard } from '@tracksmith/shared';
import WebSocket from 'ws';
import type { CardStore } from '../db/store.js';
import type { GatewayClient } from '../gateway/client.js';
import { Projector } from '../gateway/projector.js';
import { settleChatWithGoalContract, settleWithGoalContract, shouldAutoRetryGoal } from '../goal-eval.js';
import type { EngineRouter } from '../engine/router.js';
import type { PendingRunRegistry } from '../pending-runs.js';

interface GatewayEvent {
  type?: string;
  event?: string;
  slot_id?: string;
  slotId?: string;
  task_id?: string;
  taskId?: string;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export class GatewayListener {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private projector: Projector;
  private reconcileFn: (() => Promise<void>) | null = null;

  constructor(
    private gateway: GatewayClient,
    private store: CardStore,
    private pending: PendingRunRegistry,
    private onUpdate: () => void,
    private router?: EngineRouter,
  ) {
    this.projector = new Projector(gateway);
  }

  setReconcile(fn: () => Promise<void>): void {
    this.reconcileFn = fn;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.gateway.wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[gateway-ws] connected');
      if (this.reconcileFn) {
        void this.reconcileFn().then(() => this.onUpdate());
      }
    });

    this.ws.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as GatewayEvent;
        void this.handleEvent(event);
      } catch {
        // ignore malformed
      }
    });

    this.ws.on('close', () => {
      console.log('[gateway-ws] disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', () => {
      this.ws?.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private resolveCardId(kind: 'chat' | 'task_runner', id: string): string | undefined {
    const pending = kind === 'chat' ? this.pending.cardForSlot(id) : this.pending.cardForTask(id);
    if (pending) return pending;
    return this.store.findByRunRef(kind, id)?.id;
  }

  private async maybeAutoRetryGoal(card: OutcomeCard): Promise<void> {
    if (!this.router || !shouldAutoRetryGoal(card)) return;
    await this.router.run(card);
    this.onUpdate();
  }

  private clearPendingForCard(card: OutcomeCard): void {
    if (card.column !== 'running') {
      this.pending.clear(card.id);
    }
  }

  private async handleEvent(event: GatewayEvent): Promise<void> {
    const type = event.type ?? event.event ?? '';
    const slotId = event.slot_id ?? event.slotId ?? (event.slot as string | undefined);
    const taskId = event.task_id ?? event.taskId;

    if (type === 'tool_call') {
      const cardId = slotId
        ? this.resolveCardId('chat', slotId)
        : taskId
          ? this.resolveCardId('task_runner', taskId)
          : undefined;
      if (!cardId) return;
      await this.store.mutate(cardId, (card) => this.projector.handleToolCall(card, event));
      this.onUpdate();
      return;
    }

    if (type === 'chat_done' && slotId) {
      const cardId = this.resolveCardId('chat', slotId);
      if (!cardId) return;
      await this.store.mutate(cardId, async (card) => {
        if (card.column !== 'running') return null;
        if (card.goalContract?.continueUntilVerified) {
          const settled = await settleChatWithGoalContract(card, this.projector, false);
          if (settled) this.clearPendingForCard(settled);
          return settled;
        }
        const settled = await this.projector.settleChat(card, false);
        if (settled) this.clearPendingForCard(settled);
        return settled;
      }).then((updated) => {
        if (updated) void this.maybeAutoRetryGoal(updated);
      });
      this.onUpdate();
      return;
    }

    if (type === 'chat_error' && slotId) {
      const cardId = this.resolveCardId('chat', slotId);
      if (!cardId) return;
      await this.store.mutate(cardId, async (card) => {
        if (card.column !== 'running') return null;
        const settled = await this.projector.settleChat(card, true, event.error ?? event.message ?? 'chat_error');
        if (settled) this.clearPendingForCard(settled);
        return settled;
      });
      this.onUpdate();
      return;
    }

    if (type === 'task_update' && taskId) {
      const cardId = this.resolveCardId('task_runner', taskId);
      if (!cardId) return;
      const message = String(event.message ?? event.status ?? type);
      await this.store.mutate(cardId, (card) => {
        card.audit.push({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          kind: 'recovery',
          message: `Task update: ${message}`,
        });
        card.evidence.push({
          id: crypto.randomUUID(),
          kind: 'note',
          label: 'Task update',
          value: message.slice(0, 500),
          createdAt: new Date().toISOString(),
        });
        return card;
      });
      this.onUpdate();
      return;
    }

    if (type === 'task_complete' && taskId) {
      const cardId = this.resolveCardId('task_runner', taskId);
      if (!cardId) {
        this.pending.noteTaskComplete(taskId);
        return;
      }
      await this.store.mutate(cardId, async (card) => {
        if (card.column !== 'running') return null;
        const runResult = await this.gateway.getTaskRunResult(taskId);
        if (runResult.status === 'unreachable' || runResult.status === 'error' || runResult.status === 'not_found') {
          card.audit.push({
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            kind: 'recovery',
            message: `Task settlement deferred: ${runResult.message ?? runResult.status}`,
          });
          return card;
        }
        const run = runResult.status === 'ok' ? (runResult.data ?? null) : null;
        if (!run) {
          card.audit.push({
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            kind: 'recovery',
            message: 'Task settlement deferred: empty run record',
          });
          return card;
        }
        let settled: OutcomeCard | null | undefined;
        if (card.goalContract?.continueUntilVerified) {
          settled = await settleWithGoalContract(card, run, this.projector);
        } else {
          settled = await this.projector.settleTask(card, run);
        }
        if (settled) this.clearPendingForCard(settled);
        return settled;
      }).then((updated) => {
        if (updated) void this.maybeAutoRetryGoal(updated);
      });
      this.onUpdate();
    }
  }
}
