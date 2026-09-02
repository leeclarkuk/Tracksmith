import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OutcomeCard } from '@tracksmith/shared';
import { abandonLocalTracking, AbandonError, ABANDON_REASON } from '../abandon.js';
import { CardStore } from '../db/store.js';
import type { GatewayClient, GatewayMessage } from '../gateway/client.js';
import { GatewayListener } from '../gateway/listener.js';
import { PendingRunRegistry } from '../pending-runs.js';

const FINAL_HISTORY: GatewayMessage[] = [
  { role: 'user', content: 'do the work' },
  { role: 'assistant', content: 'Done. Tests pass and README is updated.' },
];

function tempStore(): CardStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracksmith-abandon-'));
  return new CardStore(path.join(dir, 'test.db'));
}

function seedCard(
  store: CardStore,
  pending: PendingRunRegistry,
  opts: { column: OutcomeCard['column']; kind?: 'chat' | 'task_runner' },
): OutcomeCard {
  const card = store.create({ prompt: 'do the work', engine: opts.kind === 'task_runner' ? 'task_runner' : 'chat' });
  card.column = opts.column;
  if (opts.kind === 'task_runner') {
    card.runRef = { kind: 'task_runner', taskId: 'task-1', sessionKey: 'taskrunner:task-1' };
    pending.start(card.id, 'task_runner');
    pending.attachTask(card.id, 'task-1');
  } else if (opts.column === 'running' || opts.kind === 'chat') {
    card.runRef = { kind: 'chat', slotId: 'slot-1', sessionKey: 'slot-1' };
    if (opts.column === 'running') {
      pending.start(card.id, 'chat');
      pending.attachSlot(card.id, 'slot-1');
    }
  }
  store.save(card);
  return store.get(card.id)!;
}

async function dispatchChatDone(store: CardStore, pending: PendingRunRegistry): Promise<void> {
  const gateway = {
    getSlotHistoryResult: async () => ({ status: 'ok' as const, data: FINAL_HISTORY }),
  } as unknown as GatewayClient;
  const listener = new GatewayListener(gateway, store, pending, () => {});
  await (
    listener as unknown as { handleEvent: (event: { type: string; slotId: string }) => Promise<void> }
  ).handleEvent({ type: 'chat_done', slotId: 'slot-1' });
}

describe('abandonLocalTracking', () => {
  it('moves a running chat to failed, clears pending, and keeps the Host reference', async () => {
    const store = tempStore();
    const pending = new PendingRunRegistry();
    const card = seedCard(store, pending, { column: 'running', kind: 'chat' });

    const updated = await abandonLocalTracking(store, pending, card.id);

    expect(updated.column).toBe('failed');
    expect(updated.failureReason).toBe(ABANDON_REASON);
    expect(updated.settledAt).toBeTruthy();
    expect(updated.runRef).toEqual({ kind: 'chat', slotId: 'slot-1', sessionKey: 'slot-1' });
    expect(updated.audit.some((a) => a.kind === 'settled' && a.message === ABANDON_REASON)).toBe(true);
    expect(pending.cardForSlot('slot-1')).toBeUndefined();
  });

  it('rejects cards that are not a running chat', async () => {
    const store = tempStore();
    const pending = new PendingRunRegistry();
    const todo = seedCard(store, pending, { column: 'todo', kind: 'chat' });
    const task = seedCard(store, pending, { column: 'running', kind: 'task_runner' });

    await expect(abandonLocalTracking(store, pending, 'missing')).rejects.toMatchObject({
      message: 'Card not found',
      statusCode: 404,
    });
    await expect(abandonLocalTracking(store, pending, todo.id)).rejects.toBeInstanceOf(AbandonError);
    await expect(abandonLocalTracking(store, pending, todo.id)).rejects.toMatchObject({ statusCode: 400 });
    await expect(abandonLocalTracking(store, pending, task.id)).rejects.toMatchObject({ statusCode: 400 });
    expect(store.get(task.id)?.column).toBe('running');
    expect(pending.cardForTask('task-1')).toBe(task.id);
  });

  it('ignores a late chat_done after local tracking is abandoned', async () => {
    const store = tempStore();
    const pending = new PendingRunRegistry();
    const card = seedCard(store, pending, { column: 'running', kind: 'chat' });

    await abandonLocalTracking(store, pending, card.id);
    await dispatchChatDone(store, pending);
    const after = store.get(card.id)!;

    expect(after.column).toBe('failed');
    expect(after.failureReason).toBe(ABANDON_REASON);
    expect(after.resultPacket).toBeUndefined();
    expect(after.runRef?.slotId).toBe('slot-1');
  });
});
