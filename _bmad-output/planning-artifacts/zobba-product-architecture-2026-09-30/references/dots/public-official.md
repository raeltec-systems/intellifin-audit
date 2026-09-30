# OpenAI dots: official public UX findings

Research date: **30 September 2026**. Scope: public OpenAI/ChatGPT announcement, product, Help Center and learning documentation. No authenticated account, user-specific dots URL, hidden API, application bundle or unpublished asset was inspected. These findings describe user-facing behavior, not OpenAI's backend design.

**The release is officially confirmed.** OpenAI's announcement is dated **29 September 2026** and is titled **Introducing dots** [S1]. The ChatGPT release notes have a matching **Meet your dot** entry [S3]. The user's report that it launched “yesterday” is therefore supported. The public route `https://chatgpt.com/dots` returned HTTP 200, but its readable page text was only “ChatGPT”; that fetch alone does not establish the signed-in interface [S13].

The supplied name **izzy**, specific account state and exact screenshot composition remain observations reported by the user. Official documentation does confirm that people name and personalize their dot, open a profile, use Call, inspect the computer, connect Slack, and review work. “Izzy” is not established as an official default name.

## The product experience official sources describe

Dots are an ongoing working relationship with an identifiable assistant, not a new chat for every task. The official guide says a person can keep talking while the dot works, change priorities, and receive results or decisions. The assistant has its own cloud computer/browser, can continue while the person's devices are off, and can work on multiple responsibilities [S4–S8].

| User-visible pattern | Official confirmation and limit |
|---|---|
| **Give it a name and open its profile** | Setup creates a default dot; people can change name and appearance. A handle starts as `@yourname-dot` and changes with the chosen name. Profile access exposes contact methods, computers and activity. The guide describes shape/color/eyes/glasses/accessories; Help also describes characters/pets. These details may reflect client/rollout variants [S4, S5, S10]. |
| **Keep one conversation while work continues** | The user can switch responsibilities, provide detail and reprioritize without restarting the work. Parallel background agents and visible separate work threads can continue while the person talks to the primary dot [S4, S7]. |
| **Review work beside the conversation** | The tasks guide includes an explicitly labeled **illustration** with task links, a follow-up, a tested draft PR, and **Activity and Outputs alongside the conversation**. It confirms the intended product pattern, not that every client/version has that exact layout [S7]. |
| **Find ongoing work in a profile/activity surface** | Desktop profile → **Activity** → task opens progress, files/results and requests for decisions, app connection, sign-in or approval. Help also describes **In progress, Scheduled, Completed** activity categories [S7, S9, S10]. |
| **Inspect the actual computer** | Profile → **Computers**, or **Open computer** offered in a handoff. The computer has its own files, software and browser sessions and can retain state between periods of use [S8]. This is direct product documentation, not an inferred backend topology. |
| **Watching is distinct from controlling** | “Opening the computer doesn't give you control.” Choose **Take over** to use mouse/keyboard and **Return control** for the dot to continue [S8]. The overview includes an illustrative browser preview labeled “{name} has control” and “Take over” [S4]. |
| **Sign in without putting credentials in chat** | A sign-in request can open a private form. Credentials and requested verification go to the remote browser outside the conversation. **Take over to sign in** is an alternative; finish and return control [S4, S8]. Help says supported forms do not expose credentials to the model [S11]. |
| **Separate saved passwords from active sessions** | **Save to Passwords** is optional when offered. Reusing a saved login for a new sign-in requires confirmation; a valid existing website session may continue without another sign-in. Cloud browser sessions are separate from the user's own browser [S8]. |
| **Call the same assistant** | Conversation phone button starts a call; desktop profile also has **Call**. People can type during the call, discuss work or decisions, and receive progress/questions. Ending the call ends the voice conversation; assigned work can continue. Dot-initiated calls are planned after launch, not available at launch [S6, S10]. |
| **Reach it through Slack/Teams** | Profile → **Add** connects an available contact method. Slack permits a DM or mentioning the dot in a channel/thread. By default it responds to its owner; the owner can instruct it to engage with others, within permissions. Channel connection does not automatically connect the person's inbox or grant application access [S6, S8]. |
| **Carry context across channels without mirroring messages** | ChatGPT, Slack, Teams and calls reach the same dot. The visible messages stay in their original channels; relevant context may inform another interaction. Ability to use private context is not permission to disclose it to that channel's audience [S6, S7]. |
| **Schedule continuing work conversationally** | Specify what, schedule/time zone/end date, meaningful changes and delivery destination; ask the dot to confirm the saved schedule. **Scheduled** is the inspection/edit/cancel surface. Supported source events can trigger work; connecting Slack alone does not establish monitoring [S5, S7]. |
| **Keep conversational guidance separate from ongoing action rules** | Built-in safeguards and connected-app permissions apply automatically. The official controls guide says clear instructions are enough to begin; custom rules are optional, not a required rule-authoring wizard for every approval [S9]. |

## Three continuing-work modes are explicit

Official docs distinguish:

1. **Assigned continuing work.** The dot tracks an objective, works between conversations, chooses when to pause/wake, delegates independent pieces and asks for decisions. Not every follow-up needs a fixed schedule [S4, S7].
2. **Saved recurring or event-driven work.** Repeating times require a saved schedule. Event monitoring is available only where the source supports it, with an explicit event/request and confirmation of what was set up. Connecting a source does not silently create monitoring [S7].
3. **Proactive research.** The dot can read permitted connected information and keep private notes to discover useful suggestions. The proactive-research tools cannot directly send messages, change app content or control a browser/computer. A subsequent action follows the normal action/permission rules. Explicitly assigned recurring work may contain authorized actions and is distinct from that read-only research [S7, S11].

This distinction supports a product that acts with initiative without treating every connection as authorization for every possible action. It is user-facing behavior documented by OpenAI; it does not reveal the scheduler, task database, queues or isolation technology implementing it.

## Controls are concrete, with important boundaries

The public **Controls** guide lists four rule behaviors [S9]:

| Rule label in that guide | Meaning |
|---|---|
| **Take action without asking** | Perform the specified action without another approval request. |
| **Take action when you say so** | Proceed when the user explicitly requests the action; otherwise ask immediately before acting. |
| **Ask before taking action** | Ask before the specified action. |
| **Hand off to you** | Ask the user to perform the action instead. |

The Help article calls the second choice **Take action if pre-approved**, explaining that “pre-approved” means explicitly requested in the prompt [S10]. These are semantically compatible descriptions with different labels. Do not claim one exact label is universal across the launch clients. The guide's navigation is **Settings → Personalization → Permissions → Custom rules**; Help describes mobile **Customize → Custom rules**. Again, preserve the interaction principle rather than treating one path as all-platform truth.

Custom rules are instructions the dot attempts to follow, not a claimed perfect enforcement boundary. They do not grant app/computer access, override built-in safety requirements or remove required confirmation to reuse saved passwords. Plugin permissions remain separate. Scoped ongoing instructions can authorize future actions within their scope; asking for drafts does not authorize sending [S9, S11].

**Pause has narrower semantics than “stop everything.”** The official guide expressly says **Pause stops the dot's current main task**, not every delegated task or future scheduled run. Delegated work is inspected/stopped through **Activity**; recurring work is disabled/deleted through **Scheduled**. **Resume** continues a paused dot. Stopping does not undo completed actions [S9]. The introductory Help article uses a broader informal “stop your dot until you're ready to resume” explanation [S10]; use the detailed guide for the actual documented distinction.

A completed run is also not the same as a successful delivered result: the tasks guide instructs users to inspect outputs and errors even after completion [S7]. This is particularly relevant to an audit product that needs to distinguish execution outcome, evidence completeness, conclusion and review.

## Memory, outputs and deletion

The learning guide separates current conversation context, relevant ChatGPT memory and the dot's own persistent notes about preferences, decisions and ongoing responsibilities [S7]. Those notes are not a complete transcript. Each delegated task has its own conversation and receives the context supplied for its work; it does not automatically receive every conversation with the dot. Calls use selected context, which can differ from a background task's context.

Help confirms that a dot can receive memories/recent context from ChatGPT and contribute to shared ChatGPT memory. Turning off ChatGPT Memory stops that sharing, but does not delete information already received. Disconnecting a plugin stops new access, but does not delete information already learned from it [S11].

At launch, Help says users **cannot directly view, modify or delete individual dot memories**; deleting the dot clears its own context. ChatGPT memory is managed separately. Files, Codex threads and ChatGPT conversations created elsewhere are stored separately and are not all removed by deleting the dot [S11]. The controls guide says **Delete** while Help describes **Reset** deleting the dot; label variation is documented, not silently resolved as if both screens were identical [S9, S10].

“The dot's context does not retain credentials, images, or screenshots” in the privacy FAQ describes **context retention** [S11]. It is not evidence that no browser profile, saved-password facility, created file or other product storage ever retains such material. Do not generalize it into an undocumented global storage guarantee.

For Zobba, inspectable evidence/working-paper versions, correction history, methodology authority and selective memory correction remain audit-specific requirements. The Dots UX is useful inspiration; its current deletion and memory limitations need not become Zobba requirements.

## Availability and documentation variations

- Official announcement and release notes: launch **29 September 2026**, gradual rollout, GPT-6 Astra, eligible Pro/Business Premium and Enterprise [S1, S3].
- Pro: eligible adults, excludes EEA, UK and Switzerland at launch. Business Premium is available across supported ChatGPT regions. Enterprise beta is off by default and an administrator must enable it; Help includes Edu/Healthcare in that enterprise statement [S3, S10, S12].
- Create the dot on desktop web or the desktop app. After creation, mobile app access depends on the supporting rollout/update. **Mobile web is not supported** [S4–S6].
- Official product page broadly says messaging/calls on web, desktop and mobile; the detailed guides clarify creation and rollout requirements. Help also says the computer opens in human control on mobile, whereas the general computer guide says opening is view-only until Take over [S8, S10]. Treat this as a documented client-specific difference, not a universal control rule.
- Calls are user-initiated at launch. Official launch/product text includes calls; Help explicitly rules out a dot initiating them [S1, S6, S10].
- Messaging guide/launch product page say **texting coming soon**. Help says there is a **limited US Pro texting beta** through a third-party provider, not Business/Enterprise. Report that distinction if relevant; do not equate broad texting availability with the demonstrated Slack/Call UI [S6, S10].
- Pricing wording is evolving: announcement/learning docs say the first dot is included, conversations do not count toward ChatGPT usage, and Work/Codex tasks still consume those products' normal limits; the release note also describes first-month rollout allowances. These are public rollout terms, not evidence of the agent's operating costs [S1, S3, S4].

## What this establishes for the Zobba design

Official evidence now supports the user's interaction target directly: an ongoing named assistant, conversation that remains available during parallel work, a real cloud computer accessible beside work, explicit Take over/Return control, private sign-in requests, output/activity navigation, conversational recurring work, and profile entry points for calls and communication channels.

The strongest transferable patterns are:

- Keep the working relationship continuous while giving individual tasks and outputs inspectable identities.
- Keep the actual computer accessible when useful; separate viewing, human control and private sign-in.
- Bring missing access, approvals and decisions back as contextual requests rather than making setup/configuration the primary workflow.
- Let people inspect Activity and Scheduled work independently, with clear stop/pause scope.
- Treat channel continuity as relevant shared context, not automatic message mirroring or disclosure authority.
- Separate proactive reading from authorized execution and recurring work.
- Let ongoing work outlive the current chat/call without making control unresponsive.

These sources do **not** establish OpenAI's runtime language, service boundaries, VM provider, display transport, operation ledger, memory database, lease/fencing protocol, latency, per-task cost, account-specific rollout state, or any guarantee that every supported website can be automated. Retain Zobba's own recommended Rust architecture, managed-computer implementation and audit-specific controls on their merits. Do not infer them from the Dots pages or copy the dot's brand/character identity into Zobba's accepted Pair identity.

## Official source index

All sources fetched on **30 September 2026**. This package includes curated short source excerpts with attribution and source URLs, not complete pages or documentation. The original research also read the site's explicitly offered public Markdown guides. [official-source-manifest.json](official-source-manifest.json) records URLs, file names, sizes and SHA-256 hashes. The `/codex/dots/...` learning links currently redirect to `/docs/dots/...`; the URLs below use the final public pages.

| ID | Official URL | Local extracted source |
|---|---|---|
| S1 | https://openai.com/index/introducing-dots/ | [introducing-dots.txt](introducing-dots.txt) |
| S2 | https://chatgpt.com/features/dots/ | [dots-feature.txt](dots-feature.txt) |
| S3 | https://help.openai.com/en/articles/6825453-chatgpt-release-notes | [chatgpt-release-dots-excerpt.txt](chatgpt-release-dots-excerpt.txt) |
| S4 | https://learn.chatgpt.com/docs/dots | [learn-dots.md](learn-dots.md) |
| S5 | https://learn.chatgpt.com/docs/dots/getting-started | [learn-dots-start.md](learn-dots-start.md) |
| S6 | https://learn.chatgpt.com/docs/dots/channels | [learn-dots-channels.md](learn-dots-channels.md) |
| S7 | https://learn.chatgpt.com/docs/dots/tasks-and-memory | [learn-dots-tasks.md](learn-dots-tasks.md) |
| S8 | https://learn.chatgpt.com/docs/dots/computers-and-apps | [learn-dots-computers.md](learn-dots-computers.md) |
| S9 | https://learn.chatgpt.com/docs/dots/controls | [learn-dots-controls.md](learn-dots-controls.md) |
| S10 | https://help.openai.com/en/articles/20001530-getting-started-with-your-dot | [getting-started-dot.txt](getting-started-dot.txt) |
| S11 | https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs | [dots-privacy.txt](dots-privacy.txt) |
| S12 | https://help.openai.com/en/articles/20001554-manage-dots-in-chatgpt-workspaces | [manage-dots.txt](manage-dots.txt) |
| S13 | https://chatgpt.com/dots | [chatgpt-dots.txt](chatgpt-dots.txt) — shell-only fetch, no authenticated UI evidence |

The OpenAI News index and DevDay recap provided official discovery corroboration; they are not needed to infer anything beyond the primary release and detailed guides. No backend claim is drawn from page source, hidden routes or asset names.
