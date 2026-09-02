import type { OutcomeCard } from '@tracksmith/shared';
import type { CardStore } from './db/store.js';
import type { PendingRunRegistry } from './pending-runs.js';

export const ABANDON_REASON = 'Local tracking abandoned; Host run state is unknown.';

export class AbandonError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404,
  ) {
    super(message);
    this.name = 'AbandonError';
  }
}

function isRunningChat(card: OutcomeCard): boolean {
  return card.column === 'running' && card.runRef?.kind === 'chat';
}

export async function abandonLocalTracking(
  store: CardStore,
  pending: PendingRunRegistry,
  id: string,
): Promise<OutcomeCard> {
  if (!store.get(id)) {
    throw new AbandonError('Card not found', 404);
  }

  const updated = await store.mutate(id, (card) => {
    if (!isRunningChat(card)) {
      throw new AbandonError('Only a running chat card can abandon local tracking', 400);
    }
    const settledAt = new Date().toISOString();
    card.column = 'failed';
    card.failureReason = ABANDON_REASON;
    card.settledAt = settledAt;
    card.audit.push({
      id: crypto.randomUUID(),
      at: settledAt,
      kind: 'settled',
      message: ABANDON_REASON,
    });
    return card;
  });

  if (!updated) {
    throw new AbandonError('Card not found', 404);
  }

  pending.clear(updated.id);
  return updated;
}
