import type { CheckResult, GoalContract } from '@tracksmith/shared';

export function normalizeGoalContract(input?: Partial<GoalContract>): GoalContract | undefined {
  if (!input?.continueUntilVerified) return undefined;
  const criteria = (input.acceptanceCriteria ?? []).map((c) => c.trim()).filter(Boolean);
  if (!criteria.length) {
    throw new Error('Goal contract requires at least one acceptance criterion');
  }
  const maxAttempts = input.maxAttempts === undefined ? 3 : Number(input.maxAttempts);
  const maxWallClockSeconds = input.maxWallClockSeconds === undefined ? 3600 : Number(input.maxWallClockSeconds);
  const maxTokenBudget = input.maxTokenBudget === undefined ? 500000 : Number(input.maxTokenBudget);
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    throw new Error('Goal contract maxAttempts must be a finite number >= 1');
  }
  if (!Number.isFinite(maxWallClockSeconds) || maxWallClockSeconds < 60) {
    throw new Error('Goal contract maxWallClockSeconds must be a finite number >= 60');
  }
  if (!Number.isFinite(maxTokenBudget) || maxTokenBudget < 1000) {
    throw new Error('Goal contract maxTokenBudget must be a finite number >= 1000');
  }
  return {
    acceptanceCriteria: criteria,
    maxAttempts: Math.floor(maxAttempts),
    maxWallClockSeconds: Math.floor(maxWallClockSeconds),
    maxTokenBudget: Math.floor(maxTokenBudget),
    continueUntilVerified: true,
    attemptCount: 0,
    tokenUsed: 0,
  };
}

function matchWithoutLeadingNegation(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags.includes('i') ? 'gi' : 'g'))) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 24), index);
    if (/\b(not|no|without|never|didn't|did not|failed to)\s*$/i.test(before)) continue;
    return true;
  }
  return false;
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
        prohibited = matchWithoutLeadingNegation(lower, /\b(error|fail(ed|s|ure)?)\b/i);
      } else if (passCriterion) {
        prohibited = matchWithoutLeadingNegation(lower, /\bfail(ed|s|ure)?\b/i);
      } else if (subjectTokens.length > 0) {
        prohibited = subjectTokens.some((t) =>
          matchWithoutLeadingNegation(lower, new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')),
        );
      } else if (subjectLower.length > 0) {
        prohibited = matchWithoutLeadingNegation(
          lower,
          new RegExp(subjectLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        );
      }
      matched = !prohibited;
    } else {
      const tokens = lowerNeedle.split(/\s+/).filter((t) => t.length > 3);
      const tokenHits =
        tokens.length > 0
          ? tokens.filter((t) => matchWithoutLeadingNegation(lower, new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))).length
          : 0;
      const fuzzyMatch = tokens.length > 0 && tokenHits >= Math.ceil(tokens.length * 0.75);
      const exactMatch = matchWithoutLeadingNegation(lower, new RegExp(lowerNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      matched = exactMatch || fuzzyMatch;
      if (failureCriterion) {
        matched = matchWithoutLeadingNegation(lower, /\bfail(ed|s|ure)?\b/i);
      } else if (passCriterion) {
        matched =
          matchWithoutLeadingNegation(lower, /\bpass(ed|es)?\b/i) &&
          !matchWithoutLeadingNegation(lower, /\bfail(ed|s|ure)?\b/i);
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
