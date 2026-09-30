# Dots UX lessons for Zobba

**Research date: 30 September 2026.** Product research first developed against the lead Zobba design, revision 2, and used for the integrated revision 3. See the [current lead design](../../Zobba-Product-and-Architecture-Design.md). This is not a build plan or a claim that the proposed Zobba behavior already exists.

OpenAI officially launched Dots on **29 September 2026**. The user's screenshots and the public documentation establish a close reference for Zobba's intended experience: an identifiable assistant that accepts responsibilities, keeps working between conversations, and brings back results or specific requests for help. The computer, activity and outputs remain within reach of that relationship. [1–5]

**Recommendation: make this continuity the interaction standard for Zobba, with engagement boundaries and audit accountability built into the work.** Retain the own Rust engine, fresh schema, continuing Task, real managed computer and standing Permissions. Dots provides evidence for a product experience; its public interface does not determine our implementation.

## Evidence and scope

This study combines four supplied screenshots, current official product/help/learning documentation, and dated launch reporting. It does not include a signed-in hands-on Dots test. No user-specific Dots URL or business application was accessed. Account details in screenshots are not reproduced.

Evidence labels used below:

- **Visible:** directly present in the supplied screenshots, numbered S1–S4 in upload order.
- **Documented:** described by OpenAI as product behavior. This is stronger than inference but is not independent performance or security verification.
- **Recommended:** a design choice for Zobba.

Assistant messages visible in a screenshot are evidence of how the assistant communicates, not independent proof that its reported actions succeeded. Still images do not establish latency, background durability or credential isolation.

## The experience the screenshots reveal

| Screen | Visible interaction | Useful lesson for Zobba |
|---|---|---|
| **S1: conversation and profile** | A named assistant, persistent composer, output link in the header, and a profile card containing Call, Slack, connected computer, recent activity and outputs. | Keep the working relationship central. Work, access and results need nearby, stable homes after messages scroll away. |
| **S2: conversation beside computer** | The conversation remains available while the desktop is open. The assistant describes useful work with its current account, then requests another role. A sign-in receipt appears. The desktop says who has control and offers Take over. | Let people delegate, watch and steer in one place. Request access when its purpose is concrete. Watching must be distinct from controlling. |
| **S3: a criterion conflict** | The assistant names two conflicting approval rules, asks which governs the investigation, and receives a short answer. | Ask narrow questions that a person can answer without rebuilding context. Preserve the answer's meaning and who gave it. |
| **S4: private sign-in and permission** | A domain-labelled sign-in dialog offers Sign in, Not now and Take over to sign in. Behind it is an upload request with one-time and standing choices. | Keep authentication outside prose. Put exceptional authority requests beside the affected action, with a durable return path. |

A plausible sequence is: accept outcome → use available access → request another role → private sign-in → clarify a governing rule → continue tests → request the next role → return accessible outputs. This reconstructs the visible content; it is not a recording of a verified end-to-end run.

The assistant's useful updates are about work: a reproduced issue, what it affects, evidence gathered and what happens next. The visible “Thinking” overlay is less informative and sometimes overlaps content. Zobba should adopt the meaningful updates and unobtrusive activity indicators, while keeping its accepted Pair identity.

## What current public information adds

### One conversation can coordinate several responsibilities

Official documentation explicitly says people can switch tasks, add details and change priorities in the same conversation. Dots can delegate parallel work and create visible task threads, while the main conversation remains available. People can open a task to inspect progress, results or requests and give further direction. Cloud work can continue while their own device is off. [2, 3]

This is the most consequential finding for Zobba. A durable Task remains the right unit for audit work, but creating or visiting a separate task conversation should not be mandatory for every instruction. “Also investigate those exceptions” can create linked work and return a compact card while the person stays in conversation.

### The computer is accessible without taking over the whole experience

The public computer guide documents Profile → Computers and contextual Open computer handoffs. Opening the desktop is ordinarily inspection; Take over transfers input, and Return control lets the assistant continue. It has its own browser sessions and files, separate from the person's browser. Some websites may block cloud browsers or require further verification. [3]

Dots also supports optional access to a person's computer, which must remain online with the app open. That is a separate product capability, not a dependency of Zobba's first complete managed-computer experience.

### Sign-in is a focused handoff

Dots documents a private form that sends credentials to the remote browser outside the conversation, plus takeover to sign in directly on the website. OpenAI says supported forms do not expose credentials to the model. An active website session and a saved password are distinct: valid sessions can continue; using a saved login for a new sign-in needs confirmation. [3, 6]

For Zobba, keep protected takeover as the general path, including MFA. A private form is a useful convenience only for a qualified integration that can meet the same containment guarantees. The visual simplicity of the modal does not establish that arbitrary website sign-in is simple or universally supported.

### Continuing work has three meanings

| Mode documented for Dots | Recommended Zobba equivalent |
|---|---|
| **Assigned ongoing work:** pursue an objective between conversations; pause or wake as appropriate. | A continuing engagement-bound Task, with outstanding dependencies, current authority and a budget. |
| **Recurring or supported event work:** a saved schedule or supported trigger, with timing, notification conditions and destination. | A scheduled or triggered Task, or a standing request. Evidence arrivals can resume existing work. For recurring assurance, use a Check based on the reviewed method; each occurrence has its own linked Task, period, evidence and result. |
| **Proactive research:** read permitted information and develop suggestions; its research tools do not send, mutate apps or control a computer. | Optional discovery within an explicitly allowed engagement/source scope. Present a useful proposal; subsequent execution needs the applicable Task authority. |

Connecting an app does not itself create a monitoring schedule. A generic “keep an eye on this” should lead to a concise, inspectable agreement about what is watched and when an update matters. [2, 4]

### Channels preserve the relationship, not one mirrored transcript

Dots supports ChatGPT, calls, Slack and Teams. The same assistant uses relevant context across them, but visible conversations remain distinct. Access to private information does not authorize disclosure to a wider channel. A person can type during a call; ending the call does not end assigned work. Calls are user-initiated at launch. [5]

For Zobba, web conversation is sufficient for the first complete experience. Later channels should reach the same authorized work, with engagement and audience checks, instead of creating disconnected assistants. Voice and Slack are useful extensions, not substitutes for a complete audit workflow.

### Controls deserve precise language

Dots documents rules for acting without asking, acting when explicitly requested, asking first, and handing the action to the person. It says users need not author a custom rule for each ordinary approval. Connected access and action authority remain distinct. [4]

Its detailed controls guide also states that Pause stops the current main task, not every delegated task or future scheduled run. These are separately managed through Activity and Scheduled. Zobba should retain the lead design's stronger Task-level control: stopping a Task stops its delegated execution, acknowledges unresolved effects, and says explicitly whether a future Check schedule remains enabled.

At launch, the privacy help says individual dot memories cannot be directly viewed, edited or deleted. Disconnecting an app stops future access but does not remove already learned context. Zobba's inspectable, scoped working knowledge and correction/invalidation behavior are valuable professional requirements to retain. [6]

## Recommended refinements to the Zobba product

### 1. Let the conversation coordinate the work

Keep one familiar Zobba identity and a continuing conversation within the active engagement. That conversation accepts new objectives, follow-ups, priorities and questions across its Tasks. Show concise work cards with objective, state, owner and the next useful action. Open a Task's dedicated history when deeper inspection is needed; returning restores the coordinating conversation.

Keep engagement selection visible. A home view can show authorized work summaries across engagements, but bringing client content into a conversation requires selecting its scope. A familiar assistant identity must not silently pool client materials. Ambiguous references such as “send that to them” need resolution against the actual work product, audience and authority.

This refines revision 2's presentation of “Task and conversation.” The continuing Task remains the record of objective, decisions, evidence and execution; a separate chat is no longer the compulsory front door for every Task.

### 2. Keep the conversation available while work happens

From the conversation, open Computer, Data, Documents or Evidence alongside it. Keep Pin, Expand, Close and Follow Zobba. Incoming activity should offer an Open card rather than displace something the person is reading or editing. A compact companion panel contains active work, Needs you, computers, work products and Permissions.

Show what is actually happening: “Matching the population,” “Checking three exceptions,” or “Waiting for source access.” Make independent progress explicit when one branch waits. Separate conversation availability, Task activity and computer connectivity so a busy desktop does not make the assistant appear unresponsive.

### 3. Make interruptions specific and easy to finish

An access request names the application, environment, required account/role and purpose. After private sign-in, distinguish Details submitted, Verifying access and Signed in as the verified role. A credentials-entered receipt alone must not resume dependent work.

A substantive question names the conflicting sources or choices, explains the effect and recommends an answer when justified. Bind the response to that question and show the accepted meaning. Only the affected work waits. If a response would change required methodology, direct that configuration change to Admin's ordinary versioned Save; do not turn a task answer into authority to override firm rules.

### 4. Apply standing Permissions without repeated ceremonies

Routine actions within existing authority proceed. When authority is missing, show the actual material, destination, account, environment and effect. Offer Allow this action and, where permitted, Set a standing rule. The standing rule has understandable scope, limits, duration and revocation; avoid a bare domain-wide “Always allow” for client information.

The user should experience a short, relevant decision. Enforcement remains in Zobba's backend, with the effective grant recorded against the operation. Dots' natural-language custom rules are not evidence for replacing that authorization contract.

### 5. Make return visits and outputs useful

Provide a compact “Since your last visit” digest: what finished, what changed, what needs input and what remains inconclusive. Keep meaningful progress in the conversation and detailed activity one step away.

Work products have stable identities, versions and review states. Chat links and the output shelf open the same object. Distinguish Draft, Ready for team review, Independently reviewed and Self-reviewed. Computer testing of an application's approval role is not an independent audit review.

### 6. Make the specialist capability present from the first task

The first complete experience binds the applicable methodology, required skills and authorized working knowledge before substantive evaluation. These shape the questions, coverage checks, analysis and working paper. They need not become a large setup questionnaire: use saved firm configuration, expose the applied basis and ask only about missing consequential choices.

The specialist value is visible when the user asks “Why is this an exception?” Zobba opens the criterion, authoritative source, relevant records, calculation, contrary evidence and limitation. A confident answer alone is insufficient. Reviewed recurring methods preserve that basis across runs, and solo use remains honestly labelled.

## A reference audit journey

1. **Delegate:** “Check whether terminated users lost access on time this quarter. Investigate exceptions and prepare the working paper.” Zobba shows a compact working brief under the active engagement and starts permitted work.
2. **Continue talking:** “Also look for shared accounts.” Zobba relates this to the current scope, creates linked work where appropriate and identifies any material expansion that needs a decision.
3. **Provide access:** “I need the read-only auditor role in the access system. I can continue matching the files while you sign in.” Open protected sign-in; verify the account after handback.
4. **Resolve a criterion:** Zobba identifies two conflicting effective-date sources, cites them and recommends the applicable interpretation. The authorized person's answer becomes an attributed decision. Required methodology changes remain Admin configuration.
5. **Inspect during work:** “Show cases with incomplete evidence.” The evidence view opens beside the same conversation. The person's inspection stays pinned while independent work continues.
6. **Return to results:** Zobba reports population coverage, supported exceptions and unresolved limitations. The working paper remains in Work products with its actual review state. Team review or permitted self-review follows the engagement's rules.
7. **Make it recurring:** “Run this monthly.” Zobba proposes a Check based on the reviewed method, with period, sources, schedule/time zone, owner, budget, standing authority and notification conditions. The saved Check is visible and each occurrence produces a draft assessment, not a fabricated human sign-off.

This journey gives the user the Dots-like continuity they asked for while making Zobba's audit specialization tangible.

## What this changes—and what remains unverified

The immediate design refinement is the conversational entry point and six reference interactions: parallel work, private access, a consequential question, bounded standing authority, returning after absence and reviewing an output. It does not justify replacing the recommended Rust engine or speculating about OpenAI's hosting, queues, database, screen transport or memory system.

The costed managed-computer design should continue to stand on our own operating assumptions and measurements. Dots being described as “always on,” or included in a subscription, reveals neither continuously provisioned desktop capacity nor per-task cost. No source reviewed establishes its interaction latency or task success rate. Zobba must validate its own responsiveness, control handoff and recovery behavior against the intended experience.

OpenAI also announced **specialist Dots for organizations**, initially as focused enterprise pilots. That is consequential positioning: Zobba's differentiated value should be firm methodology, defensible evaluation, evidence provenance, recurring methods and accountable review, delivered through this approachable experience. The launch does not itself establish audit-specific capabilities. [1]

The public documentation is evolving. Labels for explicit-request rules and Delete/Reset differ; texting is described as coming soon in the learning guide and as a limited US beta in Help; mobile takeover differs from the general desktop description. These variations do not change the core interaction recommendation. No new business approval is required to use these UX findings as a design reference.

## Sources

All accessed 30 September 2026. Official detailed guides govern exact behavior where introductory or press wording is broader.

1. [OpenAI — Introducing dots, 29 September 2026](https://openai.com/index/introducing-dots/): launch, ongoing relationship, computer, multiple responsibilities and specialist enterprise pilots.
2. [ChatGPT Learn — Tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory): parallel tasks, continuing work, schedules, event monitoring, context and proactive research.
3. [ChatGPT Learn — Connect computers and apps](https://learn.chatgpt.com/docs/dots/computers-and-apps): inspection, takeover, private sign-in, browser sessions and app access.
4. [ChatGPT Learn — Control your dot](https://learn.chatgpt.com/docs/dots/controls): activity, custom rules, permissions and exact pause/stop scope.
5. [ChatGPT Learn — Message your dot](https://learn.chatgpt.com/docs/dots/channels): calls, Slack/Teams, audience limits and distinct channel conversations.
6. [OpenAI Help — Dots privacy, security and safety FAQs](https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs): sign-in claims, memory limitations and access/disconnection behavior.
7. [OpenAI Help — Getting started with your dot](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot): onboarding, profile, activity and rollout details.
8. [WIRED — OpenAI’s Dots Are Always-On AI Agents, 29 September 2026](https://www.wired.com/story/openai-dots-always-on-ai-agents-that-proactively-help/): launch reporting and descriptions of demos; not independent hands-on validation.
9. [9to5Google — OpenAI launches Dots, 29 September 2026](https://9to5google.com/2026/09/29/openai-dots-agent/): corroborating launch report; examples attributed to OpenAI.

Supporting notes in this research directory: [screenshot-study.md](screenshot-study.md), [public-official.md](public-official.md), [public-secondary.md](public-secondary.md) and [official-source-manifest.json](official-source-manifest.json). Screenshots remain the user's supplied conversation evidence; they are not reproduced in the artifact.
