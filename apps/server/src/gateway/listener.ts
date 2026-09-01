import WebSocket from 'ws';
import type { CardStore } from '../db/store.js';
import type { GatewayClient } from '../gateway/client.js';
import { Projector } from '../gateway/projector.js';
import { evaluateGoalContract } from '../goal-contract.js';

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
    private onUpdate: () => void,
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

  private async handleEvent(event: GatewayEvent): Promise<void> {
    const type = event.type ?? event.event ?? '';
    const slotId = event.slot_id ?? event.slotId;
    const taskId = event.task_id ?? event.taskId;

    if (type === 'tool_call') {
      const card = slotId
        ? this.store.findByRunRef('chat', slotId)
        : taskId
          ? this.store.findByRunRef('task_runner', taskId)
          : undefined;
      if (card) {
        this.store.save(this.projector.handleToolCall(card, event));
        this.onUpdate();
      }
      return;
    }

    if (type === 'chat_done' && slotId) {
      const card = this.store.findByRunRef('chat', slotId);
      if (card && card.column === 'running') {
        const settled = await this.projector.settleChat(card, false);
        this.store.save(settled);
        this.onUpdate();
      }
      return;
    }

    if (type === 'chat_error' && slotId) {
      const card = this.store.findByRunRef('chat', slotId);
      if (card && card.column === 'running') {
        const settled = await this.projector.settleChat(card, true, event.error ?? event.message ?? 'chat_error');
        this.store.save(settled);
        this.onUpdate();
      }
      return;
    }

    if (type === 'task_update' && taskId) {
      const card = this.store.findByRunRef('task_runner', taskId);
      if (card) {
        const message = String(event.message ?? event.status ?? type);
        this.store.appendAudit(card, 'recovery', `Task update: ${message}`);
        this.store.appendEvidence(card, { kind: 'note', label: 'Task update', value: message.slice(0, 500) });
        this.onUpdate();
      }
      return;
    }

    if (type === 'task_complete' && taskId) {
      const card = this.store.findByRunRef('task_runner', taskId);
      if (card && card.column === 'running') {
        const run = await this.gateway.getTaskRun(taskId);
        const settled = card.goalContract?.continueUntilVerified
          ? await evaluateGoalContract(card, run, this.store, this.projector)
          : await this.projector.settleTask(card, run);
        this.store.save(settled);
        this.onUpdate();
      }
    }
  }
}
