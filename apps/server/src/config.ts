import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  host: string;
  gatewayUrl: string;
  gatewayToken: string;
  gatewayRequestTimeoutMs: number;
  apiToken: string;
  corsOrigin: string | true;
  databasePath: string;
  webDistPath: string;
}

export function loadConfig(): ServerConfig {
  const root = path.resolve(__dirname, '../../..');
  const corsEnv = process.env.CORS_ORIGIN?.trim();
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '127.0.0.1',
    gatewayUrl: (process.env.GATEWAY_URL ?? 'http://localhost:5476').replace(/\/$/, ''),
    gatewayToken: process.env.GATEWAY_TOKEN ?? '',
    gatewayRequestTimeoutMs: Number(process.env.GATEWAY_REQUEST_TIMEOUT_MS ?? 30_000),
    apiToken: process.env.TRACKSMITH_API_TOKEN ?? '',
    corsOrigin: corsEnv === '*' ? true : (corsEnv || 'http://localhost:5173'),
    databasePath: process.env.DATABASE_PATH ?? path.join(root, 'data', 'tracksmith.db'),
    webDistPath: process.env.WEB_DIST_PATH ?? path.join(root, 'apps', 'web', 'dist'),
  };
}
