import type { OutcomeCard } from '@tracksmith/shared';
import type { CardStore } from './db/store.js';
import type { TaskRunRecord } from './gateway/client.js';
import { Projector } from './gateway/projector.js';
import {
  allChecksPassed,
  evaluateAcceptanceCriteria,
  goalContractCorpus,
  mergeAcceptanceChecks,
} from './goal-contract.js';

function buildCorpus(card: OutcomeCard, run: TaskRunRecord | null, extra = ''): string {
  const runStartedAt = card.goalContract?.startedAt
    ? new Date(card.goalContract.startedAt).getTime()
    : undefined;
  const runSteps = (run?.steps ?? [])
    .map((s) => `${s.result ?? ''} ${s.error ?? ''}`.trim())
    .filter(Boolean)
    .join('\n');
  const currentRunEvidence = runStartedAt
    ? card.evidence
        .filter((e) => new Date(e.createdAt).getTime() >= runStartedAt)
        .map((e) => `${e.label} ${e.value}`)
        .join('\n')
    : '';
  return goalContractCorpus([
    runSteps,
    currentRunEvidence,
    extra,
    card.resultPacket?.finalSummary ?? '',
  ]);
}

export async function settleWithGoalContract(
  card: OutcomeCard,
  run: TaskRunRecord | null,
  store: CardStore,
  projector: Projector,
): Promise<OutcomeCard> {
  const contract = card.goalContract;
  if (!contract?.continueUntilVerified) {
    const result = await projector.settleTask(card, run);
    return result ?? card;
  }

  if (!run) {
    card.column = 'failed';
    card.failureReason = 'Task run record unavailable at settlement';
    card.settledAt = new Date().toISOString();
    store.save(card);
    return card;
  }

  let settled = await projector.settleTask(card, run);
  if (!settled) return card;
  const corpus = buildCorpus(settled, run);
  settled.resultPacket!.checks = mergeAcceptanceChecks(settled.resultPacket!.checks, contract, corpus);
  const passed = allChecksPassed(
    evaluateAcceptanceCriteria(contract.acceptanceCriteria, corpus).length
      ? evaluateAcceptanceCriteria(contract.acceptanceCriteria, corpus)
      : settled.resultPacket!.checks,
  );

  return evaluateGoalContractLimits(settled, passed, store);
}

export async function settleChatWithGoalContract(
  card: OutcomeCard,
  store: CardStore,
  projector: Projector,
  failed: boolean,
  error?: string,
): Promise<OutcomeCard> {
  const contract = card.goalContract;
  let settled = await projector.settleChat(card, failed, error);
  if (!settled) return card;
  if (!contract?.continueUntilVerified || failed) {
    store.save(settled);
    return settled;
  }

  const corpus = buildCorpus(settled, null, settled.resultPacket?.finalSummary ?? '');
  settled.resultPacket!.checks = mergeAcceptanceChecks(settled.resultPacket!.checks, contract, corpus);
  const acceptance = evaluateAcceptanceCriteria(contract.acceptanceCriteria, corpus);
  const passed = allChecksPassed(acceptance.length ? acceptance : settled.resultPacket!.checks);
  return evaluateGoalContractLimits(settled, passed, store);
}

export function evaluateGoalContractLimits(
  settled: OutcomeCard,
  verificationPassed: boolean,
  store: CardStore,
): OutcomeCard {
  const contract = settled.goalContract!;
  const tokens = contract.tokenUsed;
  const elapsedSec = contract.startedAt
    ? (Date.now() - new Date(contract.startedAt).getTime()) / 1000
    : 0;

  if (verificationPassed) {
    store.save(settled);
    return settled;
  }

  const limitsExceeded =
    contract.attemptCount >= contract.maxAttempts ||
    elapsedSec >= contract.maxWallClockSeconds ||
    tokens >= contract.maxTokenBudget;

  if (limitsExceeded) {
    settled.column = 'failed';
    settled.failureReason = 'Goal contract limits exhausted before acceptance criteria passed';
    settled.resultPacket!.nextActions = ['Relax acceptance criteria or increase limits, then retry'];
    settled.settledAt = new Date().toISOString();
    store.save(settled);
    return settled;
  }

  settled.column = 'todo';
  settled.failureReason = undefined;
  settled.settledAt = undefined;
  settled.resultPacket!.nextActions = [
    'Acceptance criteria not met. Review checks and run again.',
    ...settled.resultPacket!.nextActions,
  ];
  settled.audit.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: 'goal_retry',
    message: `Attempt ${contract.attemptCount}/${contract.maxAttempts} did not pass acceptance criteria`,
  });
  store.save(settled);
  return settled;
}
