import type { ServerConfig } from '../config.js';

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
      return {
        ok: true,
        taskRunnerEnabled: data.taskrunner !== false && (data.features as Record<string, unknown> | undefined)?.taskrunner !== false,
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

  async listSlots(): Promise<GatewaySlot[]> {
    try {
      const data = await this.request<{ slots?: GatewaySlot[] } | GatewaySlot[]>('GET', '/api/slots');
      return Array.isArray(data) ? data : (data.slots ?? []);
    } catch {
      return [];
    }
  }

  async getSlotHistory(slotId: string, limit = 50): Promise<GatewayMessage[]> {
    try {
      const data = await this.request<{ messages?: GatewayMessage[]; history?: GatewayMessage[] }>(
        'GET',
        `/api/slots/${encodeURIComponent(slotId)}/history?limit=${limit}`,
      );
      return data.messages ?? data.history ?? [];
    } catch {
      return [];
    }
  }

  async sendMessage(slotId: string, message: string): Promise<void> {
    await this.request('POST', `/api/slots/${encodeURIComponent(slotId)}/message`, { message });
  }

  async startTaskRunner(spec: string): Promise<TaskRunRecord> {
    const data = await this.request<TaskRunRecord>('POST', '/api/taskrunner', { spec });
    if (!data.task_id) throw new Error('Gateway did not return task_id');
    return data;
  }

  async getTaskRun(taskId: string): Promise<TaskRunRecord | null> {
    try {
      return await this.request<TaskRunRecord>('GET', `/api/taskrunner/${encodeURIComponent(taskId)}`);
    } catch {
      return null;
    }
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
    return this.request('POST', `/api/taskrunner/${encodeURIComponent(taskId)}/to-chat`, {});
  }
}
