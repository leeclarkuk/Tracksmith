import type { OutcomeCard } from '@tracksmith/shared';
import type { CardStore } from './db/store.js';
import type { GatewayClient } from './gateway/client.js';
import { Projector } from './gateway/projector.js';

export async function reconcileRunningCards(store: CardStore, gateway: GatewayClient, projector: Projector): Promise<number> {
  const running = store.getRunning();
  let count = 0;

  for (const card of running) {
    let updated = false;

    if (card.runRef?.kind === 'chat' && card.runRef.slotId) {
      const slots = await gateway.listSlots();
      const slot = slots.find((s: { id: string }) => s.id === card.runRef!.slotId);
      if (!slot) {
        card.column = 'todo';
        card.failureReason = undefined;
        card.runRef = undefined;
        card.audit.push({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          kind: 'reconciled',
          message: 'Orphaned chat run: slot no longer exists; reverted to todo',
        });
        updated = true;
      } else {
        const history = await gateway.getSlotHistory(card.runRef.slotId, 3);
        const last = history[history.length - 1];
        if (last?.role === 'assistant') {
          const settled = await projector.settleChat(card, false);
          store.save(settled);
          count++;
          continue;
        }
      }
    }

    if (card.runRef?.kind === 'task_runner' && card.runRef.taskId) {
      const run = await gateway.getTaskRun(card.runRef.taskId);
      if (!run) {
        card.column = 'todo';
        card.runRef = undefined;
        card.audit.push({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          kind: 'reconciled',
          message: 'Orphaned task run: no Host record; reverted to todo',
        });
        updated = true;
      } else if (run.status === 'completed' || run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
        const settled = await projector.settleTask(card, run);
        store.save(settled);
        count++;
        continue;
      } else if (run.status === 'paused' || run.status === 'running') {
        card.column = 'todo';
        card.audit.push({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          kind: 'reconciled',
          message: `Task run ${run.status} after gateway restart; reverted to todo for retry`,
        });
        updated = true;
      }
    }

    if (updated) {
      store.save(card);
      count++;
    }
  }

  return count;
}
