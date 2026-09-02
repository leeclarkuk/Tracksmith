import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { CardStore } from './db/store.js';
import { EngineRouter } from './engine/router.js';
import { GatewayClient } from './gateway/client.js';
import { GatewayListener } from './gateway/listener.js';
import { reconcileRunningCards } from './reconcile.js';
import { tryRunGoalRetry } from './goal-eval.js';
import { Projector } from './gateway/projector.js';
import { PendingRunRegistry } from './pending-runs.js';
import { registerAuth, registerRoutes } from './routes.js';

const config = loadConfig();
const store = new CardStore(config.databasePath);
const gateway = new GatewayClient(config);
const pending = new PendingRunRegistry();
const router = new EngineRouter(store, gateway, config.gatewayUrl, pending);
const projector = new Projector(gateway);

const sseClients = new Set<(payload: string) => void>();

function broadcast(): void {
  const payload = JSON.stringify({ type: 'refresh', cards: store.list() });
  for (const send of sseClients) send(payload);
}

function redactTokenFromUrl(url: string): string {
  return url.replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]');
}

const app = Fastify({
  logger: {
    level: 'info',
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: redactTokenFromUrl(req.url),
        };
      },
    },
  },
});

app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (body === '' || body == null) {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(body as string));
  } catch (err) {
    done(err as Error, undefined);
  }
});

await app.register(cors, { origin: config.corsOrigin });
registerAuth(app, config);
registerRoutes(app, store, gateway, router, broadcast);

app.get('/api/stream', async (req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (payload: string) => reply.raw.write(`data: ${payload}\n\n`);
  send(JSON.stringify({ type: 'refresh', cards: store.list() }));
  sseClients.add(send);
  req.raw.on('close', () => sseClients.delete(send));
});

if (fs.existsSync(config.webDistPath)) {
  await app.register(fastifyStatic, {
    root: config.webDistPath,
    prefix: '/',
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      reply.code(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html');
    }
  });
}

const listener = new GatewayListener(gateway, store, pending, broadcast, router);

async function runReconcile(startup = false): Promise<void> {
  const reconciled = await reconcileRunningCards(store, gateway, projector, {
    settleChatFromHistory: startup,
    router,
    pending,
  });
  if (reconciled > 0) {
    console.log(`[reconcile] updated ${reconciled} running card(s)`);
    broadcast();
  }
  if (startup) {
    for (const card of store.list()) {
      await tryRunGoalRetry(router, card);
    }
    broadcast();
  }
}

let reconcileInFlight = false;

async function runReconcileSafe(startup = false): Promise<void> {
  if (reconcileInFlight) return;
  reconcileInFlight = true;
  try {
    await runReconcile(startup);
  } catch (err) {
    console.error('[reconcile] failed:', err instanceof Error ? err.message : err);
  } finally {
    reconcileInFlight = false;
  }
}

listener.setReconcile(() => runReconcileSafe(false));

const reconcileInterval = setInterval(() => {
  void runReconcileSafe(false);
}, 30_000);

async function start(): Promise<void> {
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.apiToken) {
    console.warn('[auth] HOST is not loopback and TRACKSMITH_API_TOKEN is unset; API is exposed without auth');
  }
  listener.start();
  await app.listen({ port: config.port, host: config.host });
  console.log(`Tracksmith listening on http://${config.host}:${config.port}`);
  void runReconcileSafe(true);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('SIGTERM', () => {
  clearInterval(reconcileInterval);
  listener.stop();
  process.exit(0);
});
