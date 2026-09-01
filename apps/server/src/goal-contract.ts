import type { OutcomeCard } from '@tracksmith/shared';
import type { CardStore } from './db/store.js';
import type { GatewayClient, TaskRunRecord } from './gateway/client.js';
import { Projector } from './gateway/projector.js';

export async function evaluateGoalContract(
  card: OutcomeCard,
  run: TaskRunRecord | null,
  store: CardStore,
  projector: Projector,
): Promise<OutcomeCard> {
  const contract = card.goalContract;
  if (!contract?.continueUntilVerified) {
    return projector.settleTask(card, run);
  }

  const now = Date.now();
  const started = contract.startedAt ? new Date(contract.startedAt).getTime() : now;
  const elapsedSec = (now - started) / 1000;
  const tokens = contract.tokenUsed + (run?.tokens_used ?? 0);

  let settled = await projector.settleTask(card, run);
  const allChecksPassed = settled.resultPacket?.checks.every((c: { passed: boolean }) => c.passed) ?? false;

  if (allChecksPassed) {
    store.save(settled);
    return settled;
  }

  const limitsExceeded =
    contract.attemptCount >= contract.maxAttempts ||
    elapsedSec >= contract.maxWallClockSeconds ||
    tokens >= contract.maxTokenBudget;

  if (limitsExceeded) {
    settled.column = 'failed';
    settled.failureReason = 'Goal contract limits exhausted before verification passed';
    settled.resultPacket!.nextActions = ['Relax acceptance criteria or increase limits, then retry'];
    settled.settledAt = new Date().toISOString();
    store.save(settled);
    return settled;
  }

  settled.column = 'todo';
  settled.failureReason = undefined;
  settled.settledAt = undefined;
  settled.resultPacket!.nextActions = [
    'Verification incomplete. Review checks and run again.',
    ...settled.resultPacket!.nextActions,
  ];
  settled.audit.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: 'goal_retry',
    message: `Attempt ${contract.attemptCount}/${contract.maxAttempts} did not pass all checks`,
  });
  store.save(settled);
  return settled;
}
