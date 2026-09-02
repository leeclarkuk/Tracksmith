import type { OutcomeCard } from '@tracksmith/shared';
import type { CardStore } from './db/store.js';
import type { GatewayClient } from './gateway/client.js';
import { Projector } from './gateway/projector.js';
import { settleWithGoalContract, shouldAutoRetryGoal } from './goal-eval.js';
import type { EngineRouter } from './engine/router.js';
import { isGoalContractElapsed } from './goal-contract.js';

function audit(card: OutcomeCard, message: string): void {
  card.audit.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: 'reconciled',
    message,
  });
}

function hasDeferredSettlement(card: OutcomeCard): boolean {
  return card.audit.some(
    (a) =>
      a.message?.includes('Settlement deferred') ||
      a.message?.includes('Task settlement deferred'),
  );
}

export async function reconcileRunningCards(
  store: CardStore,
  gateway: GatewayClient,
  projector: Projector,
  options: { settleChatFromHistory?: boolean; router?: EngineRouter } = {},
): Promise<number> {
  const gatewayStatus = await gateway.getStatus();
  if (!gatewayStatus.ok) {
    console.log('[reconcile] skipped: gateway unreachable');
    return 0;
  }

  const running = store.getRunning();
  let count = 0;

  for (const snapshot of running) {
    const updated = await store.mutate(snapshot.id, async (card) => {
      if (card.column !== 'running') return null;

      if (card.goalContract?.continueUntilVerified && isGoalContractElapsed(card.goalContract)) {
        card.column = 'failed';
        card.failureReason = 'Goal contract wall-clock limit exceeded while running';
        card.settledAt = new Date().toISOString();
        audit(card, 'Wall-clock limit exceeded during run');
        return card;
      }

      if (!card.runRef) {
        card.column = 'todo';
        audit(card, 'Dispatch incomplete: no run reference; reverted to todo');
        return card;
      }

      if (card.runRef.kind === 'chat' && card.runRef.slotId) {
        return reconcileChatCard(card, gateway, projector, options.settleChatFromHistory === true);
      }

      if (card.runRef.kind === 'task_runner' && card.runRef.taskId) {
        return reconcileTaskCard(card, gateway, projector);
      }

      return null;
    });

    if (updated) {
      count++;
      if (options.router && shouldAutoRetryGoal(updated)) {
        await options.router.run(updated);
      }
    }
  }

  return count;
}

async function reconcileChatCard(
  card: OutcomeCard,
  gateway: GatewayClient,
  projector: Projector,
  settleFromHistory: boolean,
): Promise<OutcomeCard | null> {
  const slotId = card.runRef!.slotId!;
  const slotsResult = await gateway.listSlotsResult();
  if (slotsResult.status === 'unreachable') {
    return null;
  }
  if (slotsResult.status !== 'ok') {
    return null;
  }

  const slot = slotsResult.data!.find((s) => s.id === slotId);
  if (!slot) {
    card.column = 'todo';
    card.runRef = undefined;
    audit(card, 'Orphaned chat run: slot confirmed missing; reverted to todo');
    return card;
  }

  const historyResult = await gateway.getSlotHistoryResult(slotId, 3);
  if (historyResult.status === 'unreachable') {
    return null;
  }
  if (historyResult.status === 'ok') {
    const last = historyResult.data![historyResult.data!.length - 1];
    if (last?.role === 'assistant') {
      audit(
        card,
        hasDeferredSettlement(card)
          ? 'Retrying deferred chat settlement from slot history'
          : settleFromHistory
            ? 'Settling chat from slot history on startup'
            : 'Settling missed chat completion from slot history on reconnect',
      );
      return projector.settleChat(card, false);
    }
  }
  return null;
}

async function reconcileTaskCard(
  card: OutcomeCard,
  gateway: GatewayClient,
  projector: Projector,
): Promise<OutcomeCard | null> {
  const taskId = card.runRef!.taskId!;
  const runResult = await gateway.getTaskRunResult(taskId);

  if (runResult.status === 'unreachable') {
    return null;
  }

  if (runResult.status === 'not_found') {
    card.column = 'todo';
    card.runRef = undefined;
    audit(card, 'Orphaned task run: Host record confirmed missing; reverted to todo');
    return card;
  }

  if (runResult.status !== 'ok' || !runResult.data) {
    return null;
  }

  const run = runResult.data;
  if (run.status === 'completed' || run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
    if (hasDeferredSettlement(card)) {
      audit(card, 'Retrying deferred task settlement from Host run record');
    }
    if (card.goalContract?.continueUntilVerified) {
      return settleWithGoalContract(card, run, projector);
    }
    return projector.settleTask(card, run);
  }

  if (run.status === 'paused') {
    card.column = 'todo';
    card.failureReason =
      'Task paused on Host after gateway restart. Resume in Host Tasks; do not Run again unless you intend a duplicate.';
    audit(card, 'Task run paused on Host; moved to todo for explicit resume');
    return card;
  }

  return null;
}
