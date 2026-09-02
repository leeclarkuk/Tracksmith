import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OutcomeCard } from '@tracksmith/shared';
import { CardStore } from '../db/store.js';
import type { GatewayClient, GatewayMessage } from '../gateway/client.js';
import { GatewayListener } from '../gateway/listener.js';
import { Projector } from '../gateway/projector.js';
import { PendingRunRegistry } from '../pending-runs.js';
import { reconcileRunningCards } from '../reconcile.js';

const INTERIM_HISTORY: GatewayMessage[] = [
  { role: 'user', content: 'do the work' },
  { role: 'assistant', content: 'INTERIM: listing test files' },
];

const FINAL_HISTORY: GatewayMessage[] = [
  { role: 'user', content: 'do the work' },
  { role: 'assistant', content: 'Done. Tests pass and README is updated.' },
];

function tempStore(): CardStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracksmith-reconcile-'));
  return new CardStore(path.join(dir, 'test.db'));
}

function fakeGateway(history: GatewayMessage[] = INTERIM_HISTORY): GatewayClient {
  return {
    getStatus: async () => ({ ok: true, taskRunnerEnabled: false }),
    listSlotsResult: async () => ({ status: 'ok' as const, data: [{ id: 'slot-1' }] }),
    getSlotHistoryResult: async () => ({ status: 'ok' as const, data: history }),
  } as unknown as GatewayClient;
}

function seedRunningChat(store: CardStore, pending: PendingRunRegistry, deferred = false): OutcomeCard {
  const card = store.create({ prompt: 'do the work', engine: 'chat', column: 'todo' });
  const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  card.column = 'running';
  card.runRef = { kind: 'chat', slotId: 'slot-1', sessionKey: 'slot-1' };
  card.audit.push({
    id: 'run-1',
    at: startedAt,
    kind: 'run_started',
    message: 'Dispatching via chat',
  });
  if (deferred) {
    card.audit.push({
      id: 'defer-1',
      at: new Date().toISOString(),
      kind: 'recovery',
      message: 'Settlement deferred: Gateway GET /api/slots/slot-1/history failed',
    });
  }
  store.save(card);
  pending.start(card.id, 'chat');
  pending.attachSlot(card.id, 'slot-1');
  return store.get(card.id)!;
}

async function dispatchChatDone(gateway: GatewayClient, store: CardStore, pending: PendingRunRegistry): Promise<void> {
  const listener = new GatewayListener(gateway, store, pending, () => {});
  await (
    listener as unknown as { handleEvent: (event: { type: string; slotId: string }) => Promise<void> }
  ).handleEvent({ type: 'chat_done', slotId: 'slot-1' });
}

describe('reconcileRunningCards chat settlement', () => {
  it('leaves an old running chat with an interim assistant message running', async () => {
    const store = tempStore();
    const pending = new PendingRunRegistry();
    const card = seedRunningChat(store, pending);
    const gateway = fakeGateway(INTERIM_HISTORY);

    const updated = await reconcileRunningCards(store, gateway, new Projector(gateway), { pending });
    const after = store.get(card.id)!;

    expect(updated).toBe(0);
    expect(after.column).toBe('running');
    expect(after.resultPacket).toBeUndefined();
    expect(pending.cardForSlot('slot-1')).toBe(card.id);
  });

  it('does not settle from history on startup without terminal evidence', async () => {
    const store = tempStore();
    const pending = new PendingRunRegistry();
    const card = seedRunningChat(store, pending);
    const gateway = fakeGateway(INTERIM_HISTORY);

    const updated = await reconcileRunningCards(store, gateway, new Projector(gateway), {
      settleChatFromHistory: true,
      pending,
    });
    const after = store.get(card.id)!;

    expect(updated).toBe(0);
    expect(after.column).toBe('running');
    expect(after.resultPacket).toBeUndefined();
    expect(pending.cardForSlot('slot-1')).toBe(card.id);
  });

  it('recovers a previously deferred settlement from slot history', async () => {
    const store = tempStore();
    const pending = new PendingRunRegistry();
    const card = seedRunningChat(store, pending, true);
    const gateway = fakeGateway(FINAL_HISTORY);

    const updated = await reconcileRunningCards(store, gateway, new Projector(gateway), { pending });
    const after = store.get(card.id)!;

    expect(updated).toBe(1);
    expect(after.column).toBe('done');
    expect(after.resultPacket?.finalSummary).toContain('Tests pass');
    expect(pending.cardForSlot('slot-1')).toBeUndefined();
  });

  it('lets a later chat_done settle the card and clear pending state', async () => {
    const store = tempStore();
    const pending = new PendingRunRegistry();
    const card = seedRunningChat(store, pending);
    const gateway = fakeGateway(INTERIM_HISTORY);

    await reconcileRunningCards(store, gateway, new Projector(gateway), {
      settleChatFromHistory: true,
      pending,
    });
    expect(store.get(card.id)?.column).toBe('running');
    expect(pending.cardForSlot('slot-1')).toBe(card.id);

    const liveGateway = fakeGateway(FINAL_HISTORY);
    await dispatchChatDone(liveGateway, store, pending);
    const after = store.get(card.id)!;

    expect(after.column).toBe('done');
    expect(after.resultPacket?.finalSummary).toContain('Tests pass');
    expect(pending.cardForSlot('slot-1')).toBeUndefined();
  });
});
