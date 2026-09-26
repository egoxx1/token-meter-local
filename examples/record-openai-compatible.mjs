// Call once after a completed text-only Chat Completions or Responses request.
// No SDK dependency. The response body/content is NOT sent to Token Meter.
// Do not import a CLI request that is already collected from its native logs.
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import client from '../src/client.js';

export async function reportTextUsage(response, {
  modelProvider, // REQUIRED billing route, e.g. 'openai', 'openrouter', 'deepseek'.
  project = process.cwd(), sessionId = 'project-api',
  requestId = response?.id || randomUUID(),
  dataDir = process.env.TOKEN_METER_HOME || path.join(os.homedir(), '.token-meter'),
} = {}) {
  try {
    if (!modelProvider || !response?.model || !response?.usage) throw new Error('Billing provider, actual model and final usage are required.');
    const u = response.usage;
    const envelope = {
      schema: 'token-meter.usage.v1', format: 'openai', modelProvider,
      model: response.model, requestId, sessionId, project,
      timestamp: new Date().toISOString(), modality: 'text',
      usage: {
        input_tokens: u.input_tokens ?? u.prompt_tokens,
        output_tokens: u.output_tokens ?? u.completion_tokens,
        total_tokens: u.total_tokens,
        input_tokens_details: {
          cached_tokens: u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens,
          cache_write_tokens: u.input_tokens_details?.cache_write_tokens ?? u.prompt_tokens_details?.cache_write_tokens,
        },
        output_tokens_details: {
          reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? u.completion_tokens_details?.reasoning_tokens,
        },
      },
    };
    return { ok: true, ...await client.request(dataDir, '/api/usage', envelope) };
  } catch (error) {
    // Metering failure should not discard the application's successful LLM answer.
    return { ok: false, error: error.message };
  }
}
// Example integration (not executed here):
// const response = await yourSdk.chat.completions.create(...);
// const result = await reportTextUsage(response, { modelProvider: 'openrouter' });
// if (!result.ok) console.warn('Usage was not recorded:', result.error);
