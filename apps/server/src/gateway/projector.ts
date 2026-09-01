import { nanoid } from 'nanoid';
import type { Artifact, CheckResult, OutcomeCard, ResultPacket } from '@tracksmith/shared';
import type { GatewayClient, GatewayMessage, TaskRunRecord } from './client.js';

const PATH_RE = /(?:^|\s)(\/[\w./-]+|~\/[\w./-]+|\.\/[\w./-]+)/g;
const URL_RE = /https?:\/\/[^\s)>\]]+/g;
const COMMIT_RE = /\b[0-9a-f]{7,40}\b/g;

function extractFromText(text: string): { artifacts: Artifact[]; paths: string[] } {
  const artifacts: Artifact[] = [];
  const paths: string[] = [];
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[1];
    if (p && !paths.includes(p)) {
      paths.push(p);
      artifacts.push({ label: p, kind: 'path', value: p });
    }
  }
  for (const m of text.matchAll(URL_RE)) {
    artifacts.push({ label: m[0], kind: 'url', value: m[0] });
  }
  return { artifacts, paths };
}

export function buildResultFromChatHistory(messages: GatewayMessage[], failed = false, error?: string): ResultPacket {
  const assistant = [...messages].reverse().filter((m) => m.role === 'assistant');
  const finalSummary = failed
    ? (error ?? assistant[0]?.content ?? 'Chat run failed')
    : (assistant[0]?.content ?? 'Run completed with no assistant response');
  const allText = messages.map((m) => m.content).join('\n');
  const { artifacts } = extractFromText(allText);
  const checks: CheckResult[] = failed
    ? [{ name: 'Chat completion', passed: false, evidence: error ?? 'chat_error event' }]
    : [{ name: 'Chat completion', passed: true, evidence: 'Assistant response received' }];
  return {
    finalSummary: finalSummary.slice(0, 4000),
    checks,
    artifacts: artifacts.slice(0, 20),
    risks: failed ? ['Run ended with an error'] : [],
    nextActions: failed ? ['Review the error and retry with a correction'] : ['Review the result or send a follow-up correction'],
    producedAt: new Date().toISOString(),
  };
}

export function buildResultFromTaskRun(run: TaskRunRecord): ResultPacket {
  const steps = run.steps ?? [];
  const passed = steps.filter((s) => s.status === 'PASSED' || s.status === 'passed');
  const failed = steps.filter((s) => s.status === 'FAILED' || s.status === 'failed');
  const checks: CheckResult[] = steps.map((s, i) => ({
    name: s.title ?? `Step ${i + 1}`,
    passed: s.status === 'PASSED' || s.status === 'passed' || s.status === 'SKIPPED' || s.status === 'skipped',
    evidence: (s.result ?? s.error ?? s.status ?? '').slice(0, 500),
  }));
  if (checks.length === 0) {
    checks.push({
      name: 'Task run',
      passed: run.status === 'completed' || run.status === 'done',
      evidence: run.error ?? run.status,
    });
  }
  const allText = steps.map((s) => `${s.result ?? ''} ${s.error ?? ''}`).join('\n');
  const { artifacts } = extractFromText(allText);
  if (run.task_id) {
    artifacts.unshift({ label: `Branch kirocrew/task/${run.task_id}`, kind: 'branch', value: `kirocrew/task/${run.task_id}` });
  }
  const success = run.status === 'completed' || run.status === 'done';
  return {
    finalSummary: success
      ? `Task completed: ${passed.length}/${steps.length || 1} steps passed`
      : (run.error ?? `Task ended with status ${run.status}`),
    checks,
    artifacts,
    risks: failed.length ? failed.map((f) => f.error ?? f.title ?? 'Step failed').filter(Boolean) as string[] : [],
    nextActions: success ? ['Review changes in Host Tasks page'] : ['Send a corrective instruction or resume in Host'],
    producedAt: new Date().toISOString(),
  };
}

export class Projector {
  constructor(private gateway: GatewayClient) {}

  async settleChat(card: OutcomeCard, failed: boolean, error?: string): Promise<OutcomeCard> {
    const history = card.runRef?.slotId ? await this.gateway.getSlotHistory(card.runRef.slotId) : [];
    card.resultPacket = buildResultFromChatHistory(history, failed, error);
    card.column = failed ? 'failed' : 'done';
    card.failureReason = failed ? (error ?? 'Chat error') : undefined;
    card.settledAt = new Date().toISOString();
    for (const a of card.resultPacket.artifacts) {
      card.evidence.push({ id: nanoid(), kind: a.kind, label: a.label, value: a.value, createdAt: new Date().toISOString() });
    }
    card.audit.push({ id: nanoid(), at: new Date().toISOString(), kind: 'settled', message: failed ? 'Settled to failed (chat)' : 'Settled to done (chat)' });
    return card;
  }

  async settleTask(card: OutcomeCard, run?: TaskRunRecord | null): Promise<OutcomeCard> {
    const taskId = card.runRef?.taskId;
    const record = run ?? (taskId ? await this.gateway.getTaskRun(taskId) : null);
    if (!record) {
      card.column = 'failed';
      card.failureReason = 'Task run record not found';
      card.settledAt = new Date().toISOString();
      return card;
    }
    card.resultPacket = buildResultFromTaskRun(record);
    const success = record.status === 'completed' || record.status === 'done';
    card.column = success ? 'done' : 'failed';
    card.failureReason = success ? undefined : (record.error ?? `Status: ${record.status}`);
    card.settledAt = new Date().toISOString();
    if (record.tokens_used && card.goalContract) {
      card.goalContract.tokenUsed += record.tokens_used;
    }
    for (const a of card.resultPacket.artifacts) {
      card.evidence.push({ id: nanoid(), kind: a.kind, label: a.label, value: a.value, createdAt: new Date().toISOString() });
    }
    card.audit.push({ id: nanoid(), at: new Date().toISOString(), kind: 'settled', message: success ? 'Settled to done (task runner)' : 'Settled to failed (task runner)' });
    return card;
  }

  handleToolCall(card: OutcomeCard, payload: Record<string, unknown>): OutcomeCard {
    const tool = String(payload.tool ?? payload.name ?? 'tool');
    const args = JSON.stringify(payload.args ?? payload.arguments ?? {});
    const { artifacts } = extractFromText(args);
    card.audit.push({ id: nanoid(), at: new Date().toISOString(), kind: 'recovery', message: `Tool call: ${tool}` });
    for (const a of artifacts.slice(0, 5)) {
      card.evidence.push({ id: nanoid(), kind: a.kind, label: a.label, value: a.value, createdAt: new Date().toISOString() });
    }
    return card;
  }
}
