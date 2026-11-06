import { existsSync } from 'node:fs';
import path from 'node:path';
import { serverRoot } from './paths.js';

// Load server/.env when present. Variables already set in the environment take precedence.
const envFile = path.join(serverRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export interface OpenAIConfig {
  /** Server-side only. Undefined when not configured; AI features then respond 503. */
  apiKey: string | undefined;
  model: string;
  /** Optional override of the API base URL (proxies, local test servers). */
  baseURL: string | undefined;
  timeoutMs: number;
}

export interface EnvConfig {
  port: number;
  openai: OpenAIConfig;
}

const DEFAULT_PORT = 3001;
export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const env: EnvConfig = {
  port: parsePositiveInt(process.env.PORT, DEFAULT_PORT),
  openai: {
    apiKey: optional(process.env.OPENAI_API_KEY),
    model: optional(process.env.OPENAI_MODEL) ?? DEFAULT_OPENAI_MODEL,
    baseURL: optional(process.env.OPENAI_BASE_URL),
    timeoutMs: parsePositiveInt(process.env.OPENAI_TIMEOUT_MS, DEFAULT_OPENAI_TIMEOUT_MS),
  },
};
