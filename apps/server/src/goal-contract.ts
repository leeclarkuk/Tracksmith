import type { CheckResult, GoalContract } from '@tracksmith/shared';

export function normalizeGoalContract(input?: Partial<GoalContract>): GoalContract | undefined {
  if (!input?.continueUntilVerified) return undefined;
  const criteria = (input.acceptanceCriteria ?? []).map((c) => c.trim()).filter(Boolean);
  if (!criteria.length) {
    throw new Error('Goal contract requires at least one acceptance criterion');
  }
  return {
    acceptanceCriteria: criteria,
    maxAttempts: Math.max(1, Number(input.maxAttempts) || 3),
    maxWallClockSeconds: Math.max(60, Number(input.maxWallClockSeconds) || 3600),
    maxTokenBudget: Math.max(1000, Number(input.maxTokenBudget) || 500000),
    continueUntilVerified: true,
    attemptCount: 0,
    tokenUsed: 0,
  };
}

export function evaluateAcceptanceCriteria(
  criteria: string[],
  corpus: string,
): CheckResult[] {
  if (!criteria.length) return [];
  const lower = corpus.toLowerCase();
  return criteria.map((criterion) => {
    const needle = criterion.trim();
    const lowerNeedle = needle.toLowerCase();
    const negated = /\b(no|not|without|never)\b/i.test(needle);
    const subject = needle.replace(/\b(no|not|without|never)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const subjectLower = subject.toLowerCase();
    const subjectTokens = subjectLower.split(/\s+/).filter((t) => t.length > 3);
    const failureCriterion = /\bfail(ed|s|ure)?\b/i.test(subjectLower);
    const passCriterion = /\bpass(ed|es)?\b/i.test(subjectLower);

    let matched: boolean;
    if (negated) {
      let prohibited = false;
      if (failureCriterion || /\berror/i.test(subjectLower)) {
        prohibited = /\b(error|fail(ed|s|ure)?)\b/i.test(lower);
      } else if (passCriterion) {
        prohibited = /\bfail(ed|s|ure)?\b/i.test(lower);
      } else if (subjectTokens.length > 0) {
        const hits = subjectTokens.filter((t) => lower.includes(t)).length;
        prohibited = hits >= Math.ceil(subjectTokens.length * 0.75);
      } else if (subjectLower.length > 0) {
        prohibited = lower.includes(subjectLower);
      }
      matched = !prohibited;
    } else {
      const tokens = lowerNeedle.split(/\s+/).filter((t) => t.length > 3);
      const tokenHits = tokens.length > 0 ? tokens.filter((t) => lower.includes(t)).length : 0;
      const fuzzyMatch = tokens.length > 0 && tokenHits >= Math.ceil(tokens.length * 0.75);
      const exactMatch = lower.includes(lowerNeedle);
      matched = exactMatch || fuzzyMatch;
      if (failureCriterion) {
        matched = /\bfail(ed|s|ure)?\b/i.test(lower);
      } else if (passCriterion) {
        matched = /\bpass(ed|es)?\b/i.test(lower) && !/\bfail(ed|s|ure)?\b/i.test(lower);
      }
    }

    return {
      name: needle,
      passed: matched,
      evidence: matched
        ? negated
          ? 'Prohibited content not found in run output'
          : 'Criterion reflected in run output'
        : negated
          ? 'Prohibited content found in run output'
          : 'Criterion not found in run output',
    };
  });
}

export function mergeAcceptanceChecks(
  existing: CheckResult[],
  contract: GoalContract | undefined,
  corpus: string,
): CheckResult[] {
  if (!contract?.continueUntilVerified || !contract.acceptanceCriteria.length) {
    return existing;
  }
  const acceptance = evaluateAcceptanceCriteria(contract.acceptanceCriteria, corpus);
  const names = new Set(acceptance.map((c) => c.name));
  const rest = existing.filter((c) => !names.has(c.name));
  return [...acceptance, ...rest];
}

export function goalContractCorpus(parts: string[]): string {
  return parts.filter(Boolean).join('\n');
}

export function isGoalContractElapsed(contract: GoalContract): boolean {
  if (!contract.startedAt) return false;
  const elapsedSec = (Date.now() - new Date(contract.startedAt).getTime()) / 1000;
  return elapsedSec >= contract.maxWallClockSeconds;
}

export function allChecksPassed(checks: CheckResult[]): boolean {
  return checks.length > 0 && checks.every((c) => c.passed);
}
