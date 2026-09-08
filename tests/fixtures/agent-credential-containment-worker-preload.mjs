import './agent-workspace-observer.mjs';

// Test-only provider interception for the compiled worker and installed SDK. The
// response deliberately contains the credential held by the worker, while the
// request contains only the authenticated, retrieved page. Nothing from this
// fixture is a production provider or a live model response.
if (process.env.ANTHROPIC_API_KEY !== 'synthetic-agent-abuse-interception') {
  throw new Error('Credential containment preload requires its synthetic provider key.');
}
const note = process.env.SYNTHETIC_CREDENTIAL_REQUEST;
const secret = process.env.SYNTHETIC_AUDIT_CREDENTIAL;
if (typeof note !== 'string' || note.length === 0 || typeof secret !== 'string' || secret.length < 16) {
  throw new Error('Credential containment preload requires its bounded synthetic fixture values.');
}
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).hostname !== 'api.anthropic.com') return realFetch(input, init);
  const body = JSON.parse(init?.body ?? await input.text());
  const wire = JSON.stringify(body);
  // The runtime/model prompt must never contain the credential. Keep this failure
  // diagnostic fixed so a bad provider request cannot print the value.
  if (wire.includes(secret)) throw new Error('Credential containment provider request included a secret.');
  const content = body.messages.at(-1).content;
  const prompt = typeof content === 'string'
    ? content
    : content.filter((part) => part.type === 'text').map((part) => part.text).join('');
  const envelope = JSON.parse(prompt);
  if (envelope.objective !== 'Inspect only the bound synthetic employee and read Status.') {
    throw new Error('Credential containment objective changed.');
  }
  const nodes = envelope.retrieved.flatMap((entry) => {
    try {
      const document = JSON.parse(entry.text);
      return Array.isArray(document.nodes) ? document.nodes : [];
    } catch {
      return [];
    }
  });
  if (!nodes.some((node) => node.label === 'Untrusted audit note' && node.value === note)) {
    throw new Error('Credential containment provider did not receive the authenticated read.');
  }
  calls += 1;
  // The rationale is a valid bounded model response. The application must refuse it
  // before response bytes can become a turn, action, artifact, event, error or UI value.
  const proposal = {
    actions: [],
    uncertainty: { kind: 'ambiguous', rationale: secret },
  };
  process.stdout.write(`Synthetic credential containment response delivered:${calls}\n`);
  return new Response(JSON.stringify({
    id: 'msg_synthetic_credential_containment',
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text: JSON.stringify(proposal) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 },
  }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'synthetic-credential-containment' } });
};
