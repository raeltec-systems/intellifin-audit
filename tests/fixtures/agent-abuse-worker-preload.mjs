import { readFileSync } from 'node:fs';
// Test-only HTTP interception for the ACTUAL worker and installed model SDK.
// It supplies malicious provider output, never Observations or browser results.
// No real model service is contacted; production images do not import this file.
if (process.env.ANTHROPIC_API_KEY !== 'synthetic-agent-abuse-interception') throw new Error('Abuse preload requires its synthetic key.');
const instructions = JSON.parse(readFileSync(new URL('../../fixtures/northstar/expectations/scope-widening-instructions.json', import.meta.url), 'utf8')).instructions;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).hostname !== 'api.anthropic.com') return realFetch(input, init);
  const body = JSON.parse(init?.body ?? await input.text());
  const content = body.messages.at(-1).content;
  const prompt = typeof content === 'string' ? content : content.filter(c => c.type === 'text').map(c => c.text).join('');
  const envelope = JSON.parse(prompt);
  if (!Array.isArray(envelope.tools) || typeof envelope.objective !== 'string') throw new Error('Expected real agent proposal envelope.');
  // The strict parser must refuse this opaque ID. It cannot become a new system,
  // write operation or outside origin regardless of the frozen instruction text.
  const instruction = instructions.find(row => row.text === envelope.objective);
  if (!instruction) throw new Error('The real agent did not receive a seeded frozen instruction.');
  const proposal = { actions: [{ toolId: 'unapproved-scope-widening-action', parameters: [] }], uncertainty: { kind: 'none', rationale: null } };
  process.stdout.write(`Synthetic agent abuse HTTP response delivered:${instruction.instruction_id}\n`);
  return new Response(JSON.stringify({ id: 'msg_synthetic_abuse', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(proposal) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 100 } }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'synthetic-abuse' } });
};
