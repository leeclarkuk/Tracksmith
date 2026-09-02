export type Column = 'backlog' | 'todo' | 'running' | 'done' | 'failed';

export type Engine = 'chat' | 'task_runner' | 'autopilot' | 'auto';

export type ResolvedEngine = 'chat' | 'task_runner' | 'autopilot';

export type RunKind = 'chat' | 'task_runner';

export interface RunRef {
  kind: RunKind;
  slotId?: string;
  taskId?: string;
  sessionKey?: string;
}

export interface GoalContract {
  acceptanceCriteria: string[];
  maxAttempts: number;
  maxWallClockSeconds: number;
  maxTokenBudget: number;
  continueUntilVerified: boolean;
  attemptCount: number;
  tokenUsed: number;
  startedAt?: string;
  attemptStartedAt?: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  evidence: string;
}

export interface Artifact {
  label: string;
  kind: 'path' | 'url' | 'commit' | 'branch';
  value: string;
}

export interface ResultPacket {
  finalSummary: string;
  checks: CheckResult[];
  artifacts: Artifact[];
  risks: string[];
  nextActions: string[];
  producedAt: string;
}

export interface EvidenceItem {
  id: string;
  kind: 'path' | 'url' | 'commit' | 'branch' | 'step' | 'note';
  label: string;
  value: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  kind: 'created' | 'run_started' | 'engine_resolved' | 'settled' | 'reconciled' | 'correction' | 'recovery' | 'goal_retry';
  message: string;
}

export interface OutcomeCard {
  id: string;
  column: Column;
  prompt: string;
  title: string;
  summary: string;
  engine: Engine;
  resolvedEngine?: ResolvedEngine;
  runRef?: RunRef;
  goalContract?: GoalContract;
  resultPacket?: ResultPacket;
  evidence: EvidenceItem[];
  audit: AuditEntry[];
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
}

export interface CreateCardInput {
  prompt: string;
  engine: Engine;
  column?: 'backlog' | 'todo';
  goalContract?: Omit<GoalContract, 'attemptCount' | 'tokenUsed'>;
}

export interface UpdateColumnInput {
  column: Column;
}

export interface CorrectCardInput {
  instruction: string;
}

export const COLUMNS: { id: Column; title: string; droppable: boolean }[] = [
  { id: 'backlog', title: 'Backlog', droppable: true },
  { id: 'todo', title: 'To do', droppable: true },
  { id: 'running', title: 'Running', droppable: false },
  { id: 'done', title: 'Done', droppable: true },
  { id: 'failed', title: 'Failed', droppable: true },
];

export const ENGINES: Engine[] = ['chat', 'task_runner', 'autopilot', 'auto'];

export function deriveTitleSummary(prompt: string): { title: string; summary: string } {
  const trimmed = prompt.trim();
  const firstLine = trimmed.split('\n')[0]?.trim() ?? 'Untitled outcome';
  const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  const rest = trimmed.includes('\n') ? trimmed.split('\n').slice(1).join(' ').trim() : '';
  const summarySource = rest || trimmed;
  const summary = summarySource.length > 160 ? `${summarySource.slice(0, 157)}…` : summarySource;
  return { title: title || 'Untitled outcome', summary: summary || title };
}

export function canTransitionColumn(from: Column, to: Column): boolean {
  if (from === to) return true;
  if (to === 'running') return false;
  if (from === 'running') return false;
  const allowed: Record<Column, Column[]> = {
    backlog: ['todo'],
    todo: ['backlog'],
    running: [],
    done: ['failed'],
    failed: ['done'],
  };
  return allowed[from]?.includes(to) ?? false;
}

export function classifyEngine(prompt: string): ResolvedEngine {
  const lower = prompt.toLowerCase();
  const lines = prompt.split('\n').filter((l) => l.trim());
  const hasNumberedSteps = /^\s*\d+[\.)]\s/m.test(prompt) || /^\s*[-*]\s/m.test(prompt);
  const multiStepKeywords = ['implement', 'migrate', 'refactor', 'build', 'deploy', 'acceptance criteria', 'step by step', 'multi-step'];
  const isStructured = hasNumberedSteps || multiStepKeywords.some((k) => lower.includes(k)) || lines.length > 5 || prompt.length > 400;
  return isStructured ? 'task_runner' : 'chat';
}

export function resolveEngine(engine: Engine, prompt: string): ResolvedEngine {
  if (engine === 'auto') return classifyEngine(prompt);
  if (engine === 'autopilot') return 'autopilot';
  if (engine === 'task_runner') return 'task_runner';
  return 'chat';
}

export function buildTaskSpec(prompt: string, goalContract?: GoalContract): string {
  let spec = `# Outcome\n\n${prompt.trim()}\n\n## Goal\nDeliver the outcome described above.\n\n## Requirements\n- Follow existing project conventions\n- Produce verifiable results\n`;
  if (goalContract?.acceptanceCriteria?.length) {
    spec += `\n## Acceptance criteria\n${goalContract.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}\n`;
  }
  return spec;
}

export function buildAutopilotPrompt(prompt: string): string {
  return `Plan this work first. Present a concise plan with stages for my approval before executing each stage.\n\n${prompt.trim()}`;
}
