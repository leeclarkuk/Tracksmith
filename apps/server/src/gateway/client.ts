import type { ServerConfig } from '../config.js';
import type { GatewayReadResult } from './types.js';

export interface GatewayStatus {
  ok: boolean;
  taskRunnerEnabled: boolean;
  version?: string;
}

export interface GatewaySlot {
  id: string;
  name?: string;
  title?: string;
}

export interface GatewayMessage {
  role: string;
  content: string;
}

export interface TaskRunStep {
  title?: string;
  status?: string;
  result?: string;
  error?: string;
}

export interface TaskRunRecord {
  task_id: string;
  status: string;
  error?: string;
  spec_path?: string;
  tokens_used?: number;
  steps?: TaskRunStep[];
}

export class GatewayClient {
  constructor(private config: ServerConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.gatewayToken) {
      h.Authorization = `Bearer ${this.config.gatewayToken}`;
    }
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.gatewayUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gateway ${method} ${path} failed: ${res.status} ${text}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }
    return undefined as T;
  }

  wsUrl(): string {
    const base = this.config.gatewayUrl.replace(/^http/, 'ws');
    const token = this.config.gatewayToken ? `?token=${encodeURIComponent(this.config.gatewayToken)}` : '';
    return `${base}/api/ws${token}`;
  }

  chatUrl(slotId: string): string {
    return `${this.config.gatewayUrl}/?slot=${encodeURIComponent(slotId)}`;
  }

  tasksUrl(taskId?: string): string {
    return taskId ? `${this.config.gatewayUrl}/tasks?task=${encodeURIComponent(taskId)}` : `${this.config.gatewayUrl}/tasks`;
  }

  async getStatus(): Promise<GatewayStatus> {
    try {
      const data = await this.request<Record<string, unknown>>('GET', '/api/status');
      const features = data.features as Record<string, unknown> | undefined;
      return {
        ok: true,
        taskRunnerEnabled: data.taskrunner === true || features?.taskrunner === true,
        version: typeof data.version === 'string' ? data.version : undefined,
      };
    } catch {
      return { ok: false, taskRunnerEnabled: false };
    }
  }

  async deriveTitleSummary(prompt: string): Promise<{ title: string; summary: string } | null> {
    try {
      const slot = await this.createSlot('tracksmith-derive');
      const derivePrompt = `Reply with JSON only: {"title":"short title max 80 chars","summary":"one sentence max 160 chars"} for this task:\n\n${prompt.slice(0, 2000)}`;
      await this.sendMessage(slot.id, derivePrompt);
      await new Promise((r) => setTimeout(r, 3000));
      const history = await this.getSlotHistory(slot.id, 5);
      const last = [...history].reverse().find((m) => m.role === 'assistant');
      if (!last?.content) return null;
      const match = last.content.match(/\{[\s\S]*"title"[\s\S]*"summary"[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]) as { title?: string; summary?: string };
      if (parsed.title && parsed.summary) return { title: parsed.title.slice(0, 80), summary: parsed.summary.slice(0, 160) };
      return null;
    } catch {
      return null;
    }
  }

  async createSlot(name: string, agent?: string): Promise<GatewaySlot> {
    const body: Record<string, string> = { name };
    if (agent) body.agent = agent;
    const data = await this.request<{ id?: string; slot?: GatewaySlot } & GatewaySlot>('POST', '/api/slots', body);
    const slot = data.slot ?? data;
    if (!slot.id) throw new Error('Gateway did not return slot id');
    return slot;
  }

  async listSlotsResult(): Promise<GatewayReadResult<GatewaySlot[]>> {
    const result = await this.requestResult<{ slots?: GatewaySlot[] } | GatewaySlot[]>('GET', '/api/slots');
    if (result.status !== 'ok') return result as GatewayReadResult<GatewaySlot[]>;
    const data = result.data!;
    return { status: 'ok', data: Array.isArray(data) ? data : (data.slots ?? []) };
  }

  async getSlotHistoryResult(slotId: string, limit = 50): Promise<GatewayReadResult<GatewayMessage[]>> {
    const result = await this.requestResult<{ messages?: GatewayMessage[]; history?: GatewayMessage[] }>(
      'GET',
      `/api/slots/${encodeURIComponent(slotId)}/history?limit=${limit}`,
    );
    if (result.status !== 'ok') return result as GatewayReadResult<GatewayMessage[]>;
    const data = result.data!;
    return { status: 'ok', data: data.messages ?? data.history ?? [] };
  }

  async getTaskRunResult(taskId: string): Promise<GatewayReadResult<TaskRunRecord>> {
    return this.requestResult<TaskRunRecord>('GET', `/api/taskrunner/${encodeURIComponent(taskId)}`);
  }

  private async requestResult<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<GatewayReadResult<T>> {
    try {
      const url = `${this.config.gatewayUrl}${path}`;
      const res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 404) {
        return { status: 'not_found', message: `404 ${path}` };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { status: 'error', message: `${res.status} ${text}` };
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return { status: 'ok', data: (await res.json()) as T };
      }
      return { status: 'ok', data: undefined as T };
    } catch (err) {
      return {
        status: 'unreachable',
        message: err instanceof Error ? err.message : 'network error',
      };
    }
  }

  async listSlots(): Promise<GatewaySlot[]> {
    const result = await this.listSlotsResult();
    return result.status === 'ok' ? result.data! : [];
  }

  async getSlotHistory(slotId: string, limit = 50): Promise<GatewayMessage[]> {
    const result = await this.getSlotHistoryResult(slotId, limit);
    return result.status === 'ok' ? result.data! : [];
  }

  async sendMessage(slotId: string, message: string): Promise<void> {
    await this.request('POST', `/api/slots/${encodeURIComponent(slotId)}/message`, { message });
  }

  async startTaskRunner(spec: string): Promise<TaskRunRecord> {
    const inlineSpec = spec.startsWith('__inline__:') ? spec : `__inline__:${spec}`;
    const data = await this.request<TaskRunRecord>('POST', '/api/taskrunner', { spec: inlineSpec });
    if (!data.task_id) throw new Error('Gateway did not return task_id');
    return data;
  }

  async getTaskRun(taskId: string): Promise<TaskRunRecord | null> {
    const result = await this.getTaskRunResult(taskId);
    return result.status === 'ok' ? (result.data ?? null) : null;
  }

  async listTaskRuns(): Promise<TaskRunRecord[]> {
    try {
      const data = await this.request<{ runs?: TaskRunRecord[] } | TaskRunRecord[]>('GET', '/api/taskrunner');
      return Array.isArray(data) ? data : (data.runs ?? []);
    } catch {
      return [];
    }
  }

  async taskToChat(taskId: string): Promise<{ slotId?: string }> {
    const data = await this.request<{ slotId?: string; slot_id?: string; id?: string }>(
      'POST',
      `/api/taskrunner/${encodeURIComponent(taskId)}/to-chat`,
      {},
    );
    return { slotId: data.slotId ?? data.slot_id ?? data.id };
  }
}
