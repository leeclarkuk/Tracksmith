import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  host: string;
  gatewayUrl: string;
  gatewayToken: string;
  databasePath: string;
  webDistPath: string;
}

export function loadConfig(): ServerConfig {
  const root = path.resolve(__dirname, '../../..');
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    gatewayUrl: (process.env.GATEWAY_URL ?? 'http://localhost:5476').replace(/\/$/, ''),
    gatewayToken: process.env.GATEWAY_TOKEN ?? '',
    databasePath: process.env.DATABASE_PATH ?? path.join(root, 'data', 'tracksmith.db'),
    webDistPath: process.env.WEB_DIST_PATH ?? path.join(root, 'apps', 'web', 'dist'),
  };
}
