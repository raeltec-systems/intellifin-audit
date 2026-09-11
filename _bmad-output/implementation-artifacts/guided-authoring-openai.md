# Writing assistance configuration and live verification

The web service calls OpenAI `gpt-5.6-terra` through the existing AI SDK provider.
Set **AUTHORING_OPENAI_API_KEY** as a server-side secret on that service. The key's
OpenAI project must have access to this model. Restart the service after configuring
it. Never use a NEXT_PUBLIC variable or paste a key into a procedure, browser, log or PR.
Leaving the key unset keeps manual writing and saving available.

This setting is independent of MODEL_PROVIDER / MODEL_ID / MODEL_API_KEY used for
plan checks and of audit-Run execution settings. No automatic provider fallback exists.
Prompt identity is `guided-prose-v1`. Calls use Responses, structured output,
`store:false`, low reasoning, no reasoning summary, no temperature and no tools.
Installed dependencies checked: ai7.0.89, @ai-sdk/openai4.0.58, @ai-sdk/anthropic4.0.47.

References consulted before implementation: [OpenAI model reference](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
[Responses API](https://platform.openai.com/docs/api-reference/responses/create), and
[AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai), with
the pinned provider's installed types and serialization source used to verify parameters.

## Bounds and stored information

- Rough notes: 8,000 characters; requested changes: 2,000; UTF-8 context: 64KB.
- Output: 6,144 tokens, at most 10,000 text characters (Objective: 4,000).
- One call per new request, no automatic retries, 30-second provider timeout.
- Six new requests per minute and thirty per hour per human across procedures.
- Suggestions expire for acceptance after ten minutes. Exact request retries reuse the
  durable receipt. Request records survive application restarts and are owned by actor/version.
- Context contains the accepted saved assignment. The projection omits source contents,
  structured source locations and credential references. Before a request, recognised
  credential URI/private-key/API-key patterns and known selected-target credential references
  in any supplied prose cause a refusal. The adapter also refuses its configured key in
  prompt text. Nothing is silently redacted; manual writing and saving remain available.
  These checks are bounded safeguards, not a comprehensive detector for arbitrary secrets;
  supplied prose must contain no secrets and remains untrusted model input.
- Bounded receipts retain current/proposed text, questions, actor/version, identity,
  hashes, expiry and token usage. Raw rough notes, feedback, reasoning and provider errors
  are not retained. Receipts currently remain until their owning version is deleted;
  expiry prevents acceptance but does not delete historical receipts. Retention maintenance
  is a review point for subsequent operational work.
- Immutable audit events retain request/section identifiers, model/prompt references,
  context and accepted-text hashes, and usage. They contain no model input or output.

## Live check and human review

Use the repository pins (Node24.20.0 and pnpm11.25.0), run `pnpm build`, securely inject
the dedicated key, then run:

```sh
node scripts/verify-authoring-provider.mts
```

This makes six sequential provider calls on labelled synthetic inputs, with no tools,
procedure writes or Runs. With no key it exits2, explicitly reports blocked and makes
zero calls. A transport or schema success is **not** a wording-quality verdict.

Read each actual response against its `reviewAgainst` statement: full population versus
sampling; negated instructions; numbers and thresholds; one-off versus recurring;
undefined policy criterion; and an embedded instruction attempting to bypass review.
Reject a response that changes the assignment or invents a requirement. For an undefined
deadline require clarification and no applicable replacement. Record strengths and defects
in the continuation log, including model/prompt identity, date and exact tested commit.

Current session: **live verification blocked**. No dedicated credential is configured.
SDK serialization, workflow and semantic-risk safeguards use explicit synthetic fixtures;
they do not establish live-provider access or semantic faithfulness.
