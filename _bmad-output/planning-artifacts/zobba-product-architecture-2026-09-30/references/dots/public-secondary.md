# Dots: public secondary-source UX evidence

Research date: 2026-09-30. Scope: public editorial pages, public documentation links, search results and public Hacker News discussion. No login, private route, executable site code, undocumented endpoint, or implementation inference. This note supplements the official sources and the user-supplied screenshots; it is not a hands-on product review.

## What is corroborated

Multiple dated public reports corroborate an OpenAI Dots launch on **2026-09-29**. The accessible reports describe a persistent conversational agent that accepts several responsibilities, continues work between conversations, uses a cloud computer and connected apps, and presents results or requests for input. This supports treating Dots as a current product reference rather than the unrelated New Computer **Dot** launched in 2024.

The strongest secondary UX material is 9to5Google's launch report, WIRED's descriptions of launch demos, and the Indian Express explainer. These primarily report what OpenAI announced; none establishes independent reliability, completion rates, responsiveness, isolation mechanisms, or operational costs.

## Verified source inventory

| Source | Exact visible title and publication information | Evidence value and limitation |
| --- | --- | --- |
| [9to5Google](https://9to5google.com/2026/09/29/openai-dots-agent/) | **OpenAI launches Dots, new ‘always-on agents’ you can assign tasks to** — Ben Schoon; **Sep 29 2026, 10:55 am PT**. Browser/search title differs: “OpenAI Dots are 'always-on agents' that can do tasks for you.” | Accessible article; clear concise description of task delegation, background research, computer visibility, custom rules and desktop-first creation. Explicitly attributes examples to OpenAI. |
| [WIRED](https://www.wired.com/story/openai-dots-always-on-ai-agents-that-proactively-help/) | **OpenAI’s Dots Are Always-On AI Agents—and Its Answer to Meta’s Muse** — Reece Rogers; **Sep 29, 2026, 1:15 PM** as displayed; timezone not established. | Accessible launch reporting. Concrete demo interaction and cross-channel continuity; not a hands-on test. |
| [The Indian Express](https://indianexpress.com/article/technology/artificial-intelligence/openai-dots-always-on-ai-agents-explained-10900652/) | **OpenAI’s Dots explained: How its ‘always on’ AI agents work, what they can do** — Tech Desk; **Updated Sep 30, 2026, 05:05 PM IST**. | Accessible explainer; same-conversation multitasking, follow-up across channels, proactive research versus action. Some broad claims and launch-detail ambiguity; defer to official documentation. |
| [SmartScope](https://smartscope.blog/en/blog/openai-dots-user-guide-creation-steps-initial-setup-2026/) | **OpenAI dots: User Guide, Creation Steps, and Initial Setup from chatgpt.com/dots** — **2026-09-30**. | Explicitly labels itself desk research, not verified on actual devices. Useful index to official setup/control pages and detailed navigation labels; do not count as independent observed UI. |
| [Hacker News](https://news.ycombinator.com/item?id=49896604) | **Dots: Always-on agents** — submitted by alvis; API creation time **2026-09-29T17:07:57.000Z**; target is OpenAI's Introducing Dots article. | Independently timestamps public discussion of the correct announcement. Comments mostly opinions or quotations from OpenAI; not functionality verification. |

## Flow evidence useful to the Zobba design

1. **A continuing conversational relationship with several responsibilities.** Indian Express describes users assigning work, adding tasks and ideas in the same chat or call, and returning through another channel. 9to5Google similarly describes discussion, feedback and voice alongside delegated tasks. The useful product pattern is a stable conversational entry point plus inspectable tasks, with the user free to keep talking while work proceeds. These accounts do not prove a shared thread or unrestricted context disclosure: official task/memory documentation says channel conversations remain distinct and delegated tasks receive selected context.

2. **The visible computer is a user-facing part of the work.** 9to5Google reports users can open their dot's cloud computer while it works, with separately granted access to the user's computer. This supports a visible workspace/computer surface alongside conversation. It does not specify the desktop substrate, restoration guarantees, fencing, credential mechanisms or streaming transport; none should be inferred.

3. **Background work has more than one meaning.** 9to5Google and Indian Express distinguish assigned ongoing work from opportunistic research over connected information. The research mode is described as read-only, unable to send messages, change app content, or control a browser/computer. Therefore the phrase “always-on” does not establish unrestricted autonomous action. For Zobba, distinguish authorized continuing tasks, scheduled/event work, and suggestions from passive research in both explanation and controls.

4. **Suggestions can become concrete, bounded decisions.** WIRED describes a launch demo in which the dot noticed a calendar conflict with dinner, offered two GrubHub options and prices, and the user selected an option and specified when to order. 9to5Google reports an internal-use example where a dot noticed an unsent invoice and prepared it for approval. The transferable pattern is a context-rich proposal with an actionable decision, followed by follow-through; these anecdotes do not demonstrate end-to-end reliability or explain payment permissions.

5. **Ongoing permission rules are distinct from connected access.** 9to5Google and WIRED report custom rules for autonomous versus approval-requiring actions. SmartScope points to the four documented behaviors and separate app/computer controls. This supports explaining standing boundaries once and applying them during work. It does not establish that natural-language rules constitute an enforceable policy engine. The official controls page explicitly says custom rules can be followed imperfectly and do not grant app access or override required confirmations; Zobba's own authorization contract should remain explicit.

6. **A profile connects identity, work and controls.** SmartScope reports customization, connected plugins, computer access, In progress/Scheduled/Completed, Activity, pause, resume and reset. These are navigational leads, not independently observed UI. The useful pattern is that the main conversation can remain simple while task details and durable control surfaces are nearby. Use the supplied screenshots and official pages to establish exact present labels and placement.

## Conflicts and cautions worth preserving

- **Password changes:** WIRED and Indian Express summarize sensitive actions as approval-requiring and include changing a password. Official [learn-dots-controls.md](learn-dots-controls.md) explicitly says the user must change the password themselves. Use the official rule; do not copy the secondary simplification.
- **Pause scope:** launch shorthand can read as stopping the whole agent. SmartScope and the official controls page distinguish pausing the main task, stopping a delegated task in Activity, and disabling/deleting a schedule. The official page is stronger evidence. Zobba should choose and name its own stop scopes clearly, without inheriting surprising partial-stop behavior merely for parity.
- **Cross-channel continuity:** WIRED/Indian Express say context carries across channels. This is a user-experience claim, not proof that all message history is copied or disclosure is authorized. Official docs preserve distinct visible conversations and audience permissions.
- **Plans, messaging and reset labels:** launch reporting simplifies rollout/availability, and SmartScope's reset wording reflects Help Center terminology while the learning controls page says Delete. Avoid presenting one immutable universal UI across web, desktop and mobile. Exact availability is not needed to derive Zobba's design.
- **Number of dots:** Indian Express describes talking to “one or many”; WIRED and 9to5Google say one included now with more planned. Do not turn future multi-dot positioning into a demonstrated launch interaction.
- **Performance and reliability:** “24/7,” “never stop,” and broad “any kind of task” wording are positioning. No fetched secondary page substantiates latency, success rate, concurrency guarantees, or production quality. Indian Express says live demos stumbled, without giving enough specific failure detail here to derive a diagnosis.

## What this research does not add

No retrieved secondary source supplies a reliable full screen-by-screen onboarding recording or independent hands-on usability study. The supplied screenshots and official guides are the stronger source for exact flows. No useful independently verified video walkthrough was found in the bounded searches. HN comments can identify reader concerns but are not representative user research; this note makes no frequency claims from them.

Reuters' search result identified a Sep 29 article titled **OpenAI takes on Meta with dots agent in autonomous AI push** at [this URL](https://www.reuters.com/business/openai-takes-meta-with-always-on-dots-agent-enterprise-ai-push-2026-09-29/), but direct access returned HTTP 401. Forbes returned 403. They are discovery leads only; no substantive finding above relies on them. Google served a JavaScript challenge and Reddit public search returned 403. DuckDuckGo HTML, Bing RSS and HN's public API were used for discovery; snippets alone were not treated as product evidence.

## Local evidence included in this package

- [9to5Google excerpt](secondary-9to5-excerpt.txt)
- [WIRED excerpt](secondary-wired-excerpt.txt)
- [Indian Express excerpt](secondary-indianexpress-excerpt.txt)
- [SmartScope excerpt](secondary-smartscope-excerpt.txt)
- [Hacker News story metadata](secondary-hn-story-metadata.json)
- [Source manifest](secondary-source-manifest.json)

These are compact public-source quotations, research summaries and source metadata. Full source URLs remain in the inventory above. Raw HTML, executable content, search captures and HN discussion comments are excluded from the package. The original research used public search only for discovery; no finding relies on a search snippet alone.
