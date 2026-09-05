// Test-only HTTP interception for the real worker composition root and installed SDK.
// This file is never imported by production code or packaged into a runtime image.
import { deriveExecutablePlan } from '../../packages/domain/dist/index.js';
if (process.env.MODEL_API_KEY !== 'isolated-synthetic-http-fixture') throw new Error('Synthetic HTTP preload requires its isolated fixture key.');
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).hostname !== 'api.anthropic.com') return realFetch(input, init);
  const body = JSON.parse(init?.body ?? await input.text());
  const content = body.messages.at(-1).content;
  const prompt = typeof content === 'string' ? content : content.filter(c => c.type === 'text').map(c => c.text).join('');
  const { authoredInputs, compilerVersion } = JSON.parse(prompt);
  const result = deriveExecutablePlan(authoredInputs, compilerVersion);
  if (!result.ok) throw new Error('Synthetic authored inputs are incomplete.');
  process.stdout.write('Synthetic Anthropic HTTP response delivered\n');
  return new Response(JSON.stringify({ id: 'msg_synthetic_fixture', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(result.plan) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 100 } }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'synthetic-http-fixture' } });
};
