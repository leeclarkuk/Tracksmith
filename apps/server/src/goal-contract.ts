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
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new Error('Goal contract maxAttempts must be a finite number between 1 and 100');
  }
  if (!Number.isFinite(maxWallClockSeconds) || maxWallClockSeconds < 60 || maxWallClockSeconds > 86_400) {
    throw new Error('Goal contract maxWallClockSeconds must be a finite number between 60 and 86400');
  }
  if (!Number.isFinite(maxTokenBudget) || maxTokenBudget < 1000 || maxTokenBudget > 10_000_000) {
    throw new Error('Goal contract maxTokenBudget must be a finite number between 1000 and 10000000');
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

const NEGATED_SUBJECT_STOPWORDS = new Set([
  'tests',
  'test',
  'existing',
  'public',
  'during',
  'migration',
  'step',
  'task',
  'unit',
  'integration',
  'changes',
  'change',
  'updated',
  'added',
]);

const ERROR_WORDS = /\b(errors?)\b/i;

const VIOLATION_SIGNALS =
  /\b(fail(s|ed|ing|ure|ures)?|failure|failures|errors?|found|detected|introduced|breaking|broke|lost|leaked|committed|violated|regressed|regression|missing|removed|unexpected)\b/i;

const FAILURE_OR_ERROR = /\b(errors?|fail(s|ed|ing|ure|ures)?|failure|failures)\b/i;

function matchFailureOrError(text: string): boolean {
  return matchWithoutLeadingNegation(text, FAILURE_OR_ERROR);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenPattern(token: string): RegExp {
  if (token.endsWith('s') && token.length > 4) {
    const stem = token.slice(0, -1);
    return new RegExp(`\\b${escapeRegex(stem)}(s|ed|ing)?\\b`, 'gi');
  }
  return new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi');
}

function hasSubjectViolation(text: string, subjectTokens: string[]): boolean {
  const meaningful = subjectTokens.filter((t) => t.length > 3 && !NEGATED_SUBJECT_STOPWORDS.has(t));
  if (!meaningful.length) return false;

  for (const token of meaningful) {
    const re = tokenPattern(token);
    for (const match of text.matchAll(re)) {
      const index = match.index ?? 0;
      const before = text.slice(Math.max(0, index - 24), index);
      if (/\b(not|no|without|never|didn't|did not|failed to)\s*$/i.test(before)) continue;
      const window = text.slice(Math.max(0, index - 16), Math.min(text.length, index + token.length + 48));
      if (VIOLATION_SIGNALS.test(window)) return true;
    }
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
    const failureCriterion = FAILURE_OR_ERROR.test(subjectLower);
    const passCriterion = /\bpass(ed|es)?\b/i.test(subjectLower);

    let matched: boolean;
    if (negated) {
      let prohibited = false;
      if (failureCriterion || ERROR_WORDS.test(subjectLower)) {
        prohibited = matchFailureOrError(lower);
      } else if (passCriterion) {
        prohibited = matchFailureOrError(lower);
      } else if (subjectTokens.length > 0) {
        prohibited = hasSubjectViolation(lower, subjectTokens);
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
        matched = matchFailureOrError(lower);
      } else if (passCriterion) {
        matched = matchWithoutLeadingNegation(lower, /\bpass(ed|es)?\b/i) && !matchFailureOrError(lower);
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
