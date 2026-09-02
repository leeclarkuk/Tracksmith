import type { OutcomeCard } from '@tracksmith/shared';
import type { TaskRunRecord } from './gateway/client.js';
import { Projector } from './gateway/projector.js';
import {
  allChecksPassed,
  evaluateAcceptanceCriteria,
  goalContractCorpus,
  mergeAcceptanceChecks,
} from './goal-contract.js';

export interface GoalRunExecutor {
  run(card: OutcomeCard): Promise<OutcomeCard>;
}

function buildCorpus(card: OutcomeCard, run: TaskRunRecord | null, extra = ''): string {
  const attemptStart = card.goalContract?.attemptStartedAt ?? card.goalContract?.startedAt;
  const attemptStartedAt = attemptStart ? new Date(attemptStart).getTime() : undefined;
  const runSteps = (run?.steps ?? [])
    .map((s) => `${s.title ?? ''} ${s.status ?? ''} ${s.result ?? ''} ${s.error ?? ''}`.trim())
    .filter(Boolean)
    .join('\n');
  const currentRunEvidence = attemptStartedAt
    ? card.evidence
        .filter((e) => new Date(e.createdAt).getTime() >= attemptStartedAt)
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
    return card;
  }

  const settled = await projector.settleTask(card, run);
  if (!settled || settled.column === 'running') return settled ?? card;
  const corpus = buildCorpus(settled, run);
  settled.resultPacket!.checks = mergeAcceptanceChecks(settled.resultPacket!.checks, contract, corpus);
  const acceptance = evaluateAcceptanceCriteria(contract.acceptanceCriteria, corpus);
  const passed = allChecksPassed(acceptance.length ? acceptance : settled.resultPacket!.checks);
  return evaluateGoalContractLimits(settled, passed, isHostRunSuccessful(run));
}

function isHostRunSuccessful(run: TaskRunRecord | null): boolean {
  if (!run) return true;
  return run.status === 'completed' || run.status === 'done';
}

export async function settleChatWithGoalContract(
  card: OutcomeCard,
  projector: Projector,
  failed: boolean,
  error?: string,
): Promise<OutcomeCard> {
  const contract = card.goalContract;
  const settled = await projector.settleChat(card, failed, error);
  if (!settled || settled.column === 'running') return settled ?? card;
  if (!contract?.continueUntilVerified || failed) {
    return settled;
  }

  const corpus = buildCorpus(settled, null, settled.resultPacket?.finalSummary ?? '');
  settled.resultPacket!.checks = mergeAcceptanceChecks(settled.resultPacket!.checks, contract, corpus);
  const acceptance = evaluateAcceptanceCriteria(contract.acceptanceCriteria, corpus);
  const passed = allChecksPassed(acceptance.length ? acceptance : settled.resultPacket!.checks);
  return evaluateGoalContractLimits(settled, passed, true);
}

export function evaluateGoalContractLimits(
  settled: OutcomeCard,
  verificationPassed: boolean,
  hostRunSucceeded: boolean,
): OutcomeCard {
  const contract = settled.goalContract!;
  const tokens = contract.tokenUsed;
  const elapsedSec = contract.startedAt
    ? (Date.now() - new Date(contract.startedAt).getTime()) / 1000
    : 0;

  const criteriaMet = verificationPassed && hostRunSucceeded;

  if (criteriaMet) {
    settled.column = 'done';
    settled.failureReason = undefined;
    settled.settledAt = settled.settledAt ?? new Date().toISOString();
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
    return settled;
  }

  settled.column = 'todo';
  settled.failureReason = undefined;
  settled.settledAt = undefined;
  settled.resultPacket!.nextActions = [
    'Acceptance criteria not met. Auto-retry scheduled.',
    ...settled.resultPacket!.nextActions,
  ];
  settled.audit.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind: 'goal_retry',
    message: `Attempt ${contract.attemptCount}/${contract.maxAttempts} did not pass acceptance criteria; queued for retry`,
  });
  return settled;
}

export function shouldAutoRetryGoal(card: OutcomeCard): boolean {
  if (card.column !== 'todo' || !card.goalContract?.continueUntilVerified) return false;
  const last = card.audit[card.audit.length - 1];
  return last?.kind === 'goal_retry';
}

export async function tryRunGoalRetry(
  router: GoalRunExecutor,
  card: OutcomeCard,
): Promise<OutcomeCard | null> {
  if (!shouldAutoRetryGoal(card)) return null;
  if (card.column !== 'todo' && card.column !== 'backlog') return null;
  try {
    return await router.run(card);
  } catch (err) {
    console.warn('[goal-retry] skipped:', err instanceof Error ? err.message : err);
    return null;
  }
}
