import OpenAI from 'openai';
import { env } from '../config/env.js';

/**
 * Shared OpenAI access for every AI feature: client configuration, strict structured-output requests and
 * translation of provider failures into safe errors. Output is returned as parsed, untrusted JSON; callers
 * validate it.
 */

const MAX_OUTPUT_TOKENS = 32_000;

export type AIModelErrorCode = 'NOT_CONFIGURED' | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_RESPONSE' | 'REFUSAL';

/** `message` is safe for clients; provider details are kept in `cause` and only logged. */
export class AIModelError extends Error {
  readonly code: AIModelErrorCode;

  constructor(code: AIModelErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AIModelError';
    this.code = code;
  }
}

export interface StructuredRequest {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Safe message used when the provider refuses. */
  refusalMessage: string;
}

export interface StructuredResponse {
  /** Model identifier reported by the provider. */
  model: string;
  data: unknown;
}

let cached: { apiKey: string; client: OpenAI } | undefined;

/** Throws NOT_CONFIGURED when no API key is set. */
export function assertAIConfigured(featureMessage = 'AI analysis is not configured on the server.'): void {
  if (!env.openai.apiKey) throw new AIModelError('NOT_CONFIGURED', featureMessage);
}

function client(): OpenAI {
  const { apiKey } = env.openai;
  if (!apiKey) throw new AIModelError('NOT_CONFIGURED', 'AI analysis is not configured on the server.');
  if (cached?.apiKey !== apiKey) {
    cached = {
      apiKey,
      client: new OpenAI({ apiKey, baseURL: env.openai.baseURL ?? null, timeout: env.openai.timeoutMs, maxRetries: 1 }),
    };
  }
  return cached.client;
}

function toAIModelError(error: unknown): AIModelError {
  if (error instanceof AIModelError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AIModelError('PROVIDER_TIMEOUT', 'The AI provider did not respond in time.', { cause: error });
  }
  return new AIModelError('PROVIDER_ERROR', 'The AI provider request failed.', { cause: error });
}

/** Sends one strict json_schema request through the Responses API (store: false) and parses the output. */
export async function requestStructuredOutput(request: StructuredRequest): Promise<StructuredResponse> {
  const model = env.openai.model;
  let response: OpenAI.Responses.Response;
  try {
    response = await client().responses.create({
      model,
      instructions: request.instructions,
      input: request.input,
      text: { format: { type: 'json_schema', name: request.schemaName, strict: true, schema: request.schema } },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
    });
  } catch (error) {
    throw toAIModelError(error);
  }

  const refusal = response.output
    ?.flatMap((item) => (item.type === 'message' ? item.content : []))
    .find((part) => part.type === 'refusal');
  if (refusal) {
    throw new AIModelError('REFUSAL', request.refusalMessage, { cause: new Error(`refusal: ${refusal.refusal}`) });
  }
  if (response.status !== 'completed') {
    throw new AIModelError('INVALID_RESPONSE', 'The AI provider returned an incomplete response.', {
      cause: new Error(`status=${response.status} reason=${response.incomplete_details?.reason ?? 'none'}`),
    });
  }

  let data: unknown;
  try {
    data = JSON.parse(response.output_text);
  } catch (error) {
    throw new AIModelError('INVALID_RESPONSE', 'The AI provider returned a malformed response.', { cause: error });
  }
  return { model: typeof response.model === 'string' && response.model ? response.model : model, data };
}
