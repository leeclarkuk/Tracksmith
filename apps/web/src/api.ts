import type { Column, CreateCardInput, Engine, OutcomeCard } from '@tracksmith/shared';

const BASE = '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string; message?: string }).error ?? (err as { message?: string }).message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listCards: () => request<OutcomeCard[]>('/api/cards'),
  createCard: (input: CreateCardInput) =>
    request<OutcomeCard>('/api/cards', { method: 'POST', body: JSON.stringify(input) }),
  moveColumn: (id: string, column: Column) =>
    request<OutcomeCard>(`/api/cards/${id}/column`, { method: 'PATCH', body: JSON.stringify({ column }) }),
  runCard: (id: string) => request<OutcomeCard>(`/api/cards/${id}/run`, { method: 'POST' }),
  correctCard: (id: string, instruction: string) =>
    request<OutcomeCard>(`/api/cards/${id}/correct`, { method: 'POST', body: JSON.stringify({ instruction }) }),
  hostUrl: (id: string) => request<{ url: string }>(`/api/cards/${id}/host-url`),
  gatewayStatus: () => request<{ ok: boolean; taskRunnerEnabled: boolean }>('/api/gateway/status'),
};

export function subscribeCards(onUpdate: (cards: OutcomeCard[]) => void): () => void {
  const es = new EventSource('/api/stream');
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as { cards?: OutcomeCard[] };
      if (data.cards) onUpdate(data.cards);
    } catch {
      // ignore
    }
  };
  return () => es.close();
}
