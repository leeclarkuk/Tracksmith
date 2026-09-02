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
import { shouldAutoRetryGoal } from './goal-eval.js';
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

const app = Fastify({ logger: true });

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
      if (shouldAutoRetryGoal(card)) {
        await router.run(card);
      }
    }
    broadcast();
  }
}

listener.setReconcile(() => runReconcile(false));

const reconcileInterval = setInterval(() => {
  void runReconcile(false);
}, 30_000);

async function start(): Promise<void> {
  await runReconcile(true);
  listener.start();
  await app.listen({ port: config.port, host: config.host });
  console.log(`Tracksmith listening on http://${config.host}:${config.port}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  clearInterval(reconcileInterval);
  listener.stop();
  process.exit(0);
});
