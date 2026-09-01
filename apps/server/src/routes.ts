import type { FastifyInstance, FastifyReply } from 'fastify';
import { canTransitionColumn, resolveEngine } from '@tracksmith/shared';
import type { ServerConfig } from './config.js';
import type { CardStore } from './db/store.js';
import type { EngineRouter } from './engine/router.js';
import { normalizeGoalContract } from './goal-contract.js';
import type { GatewayClient } from './gateway/client.js';

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: message });
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

export function registerAuth(app: FastifyInstance, config: ServerConfig): void {
  if (!config.apiToken) return;

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.url === '/api/health') return;
    const header = req.headers.authorization;
    const query = req.query as { token?: string };
    const queryToken = typeof query.token === 'string' ? query.token : undefined;
    const token = header?.startsWith('Bearer ')
      ? header.slice(7)
      : (req.headers['x-tracksmith-token'] ?? queryToken);
    if (token !== config.apiToken) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}

export function registerRoutes(
  app: FastifyInstance,
  store: CardStore,
  gateway: GatewayClient,
  router: EngineRouter,
  broadcast: () => void,
): void {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/cards', async () => store.list());

  app.get('/api/cards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const card = store.get(id);
    if (!card) return notFound(reply, 'Card not found');
    return card;
  });

  app.post('/api/cards', async (req, reply) => {
    const body = req.body as {
      prompt?: string;
      engine?: string;
      column?: 'backlog' | 'todo';
      goalContract?: { continueUntilVerified?: boolean; acceptanceCriteria?: string[] };
    };
    if (!body.prompt?.trim()) return badRequest(reply, 'prompt is required');
    const engine = (body.engine ?? 'auto') as 'chat' | 'task_runner' | 'autopilot' | 'auto';

    if (body.goalContract?.continueUntilVerified) {
      const resolved = resolveEngine(engine, body.prompt.trim());
      if (resolved !== 'task_runner') {
        return badRequest(
          reply,
          'Continue until verified requires Task Runner (choose Task Runner or Auto with a structured prompt)',
        );
      }
    }

    let title: string | undefined;
    let summary: string | undefined;
    const derived = await gateway.deriveTitleSummary(body.prompt.trim());
    if (derived) {
      title = derived.title;
      summary = derived.summary;
    }

    let goalContract;
    try {
      goalContract = normalizeGoalContract(body.goalContract as never);
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : 'Invalid goal contract');
    }

    const card = store.create(
      {
        prompt: body.prompt.trim(),
        engine,
        column: body.column ?? 'todo',
        goalContract,
      },
      title,
      summary,
    );
    broadcast();
    return card;
  });

  app.patch('/api/cards/:id/column', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { column } = req.body as { column?: string };
    const card = store.get(id);
    if (!card) return notFound(reply, 'Card not found');
    if (!column) return badRequest(reply, 'column is required');
    if (!canTransitionColumn(card.column, column as never)) {
      return badRequest(reply, `Invalid transition ${card.column} → ${column}`);
    }
    card.column = column as typeof card.column;
    store.save(card);
    broadcast();
    return card;
  });

  app.post('/api/cards/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const card = store.get(id);
    if (!card) return notFound(reply, 'Card not found');
    const updated = await router.run(card);
    broadcast();
    return updated;
  });

  app.post('/api/cards/:id/correct', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { instruction } = req.body as { instruction?: string };
    if (!instruction?.trim()) return badRequest(reply, 'instruction is required');
    const card = store.get(id);
    if (!card) return notFound(reply, 'Card not found');
    try {
      const updated = await router.correct(card, instruction.trim());
      broadcast();
      return updated;
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : 'Correction failed');
    }
  });

  app.get('/api/cards/:id/host-url', async (req, reply) => {
    const { id } = req.params as { id: string };
    const card = store.get(id);
    if (!card) return notFound(reply, 'Card not found');
    return { url: router.hostUrl(card) };
  });

  app.get('/api/gateway/status', async () => gateway.getStatus());
}
