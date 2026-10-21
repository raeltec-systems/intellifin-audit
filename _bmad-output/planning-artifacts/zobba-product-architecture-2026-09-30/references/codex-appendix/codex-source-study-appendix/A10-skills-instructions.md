# Skills and instructions in Codex (commit 8ffd91e42aa001b7e897bea812b02f89264f9fa0)

Area: skills, instructions, precedence, hooks, prompt-injection defences, provenance. Paths are relative to the Codex repo root. Read-only: no cargo, no test run.

## Summary

1. Skills load in two steps: a bounded catalog (developer role) every session, then a body read at mention time and injected as a user-role `<skill>` item; scripts run on the ordinary sandboxed exec path with no per-skill permission.
2. A skill has no version, hash, signature or tool allow-list; admission is enable/disable rules read only from User and SessionFlags layers, and `requirements.toml` has no skills field.
3. Repo-local skills and AGENTS.md are not trust-gated (trust covers "project-local config, hooks, and exec policies"); a test pins that a disabled project layer still yields a Repo skill root.
4. A mentioned skill can install an MCP server (even a stdio command) into global config after a prompt; the prompt is skipped under `Never` approval with a full-write profile; default on for first-party clients.
5. AGENTS.md: root-to-cwd walk, 32 KiB budget, silent truncation, user-role message; skipped only for an explicitly `untrusted` project.
6. Precedence is role placement plus catalog prose ("user instructions beat skills"); admin `additional_developer_instructions` render last; typed fragments (role + `ContentItemKind`) decide authority, not text markers.
7. Extension points: `UserInstructionsProvider`, `ThreadInstructionsProvider` (10,000-token cap), client `additional_context` (Application to developer, Untrusted to tagged user text), and command hooks trusted by SHA-256 of a normalised identity.
8. Guardian ("auto-review") is an opt-in, read-only reviewer sub-agent for approval requests only, with a written trust taxonomy, per-line role labels, config isolation and fail-closed limits (3 attempts, 90 s); it does not filter model input.
9. MCP and web_search results reach the model unframed; no prompt-injection eval suite found; persisted provenance is rendered text plus paths, with no file hashes, skill-invocation event or trust level.
10. Audit harness: keep typed fragments, managed-last placement, hash trust, guardian evidence rules; change to per-turn hashed, pinned, tenant-scoped instruction manifests; refuse repo-local trust, skill-driven config writes, unpinned installers, silent truncation.

Labels: [OBSERVED] read in code; [TEST] test exists (read, not run; I say what it would detect); [INFERENCE] my reasoning; [DOC] repo docs. Zobba statements come only from the project CLAUDE.md in my session.

## Findings

### F1. Skill discovery, file format and limits
- Problem: give the model reusable procedures without loading all text each turn. [INFERENCE]
- Code and state: a skill is `SKILL.md` with YAML `name`, `description`, `metadata.short-description`; other keys are ignored, so there is no version, permission or tool key (`codex-rs/skills/src/parser.rs:L6-L20,L44-L92`). Optional `agents/openai.yaml` holds `interface`, `dependencies.tools[]`, `policy{allow_implicit_invocation, products}`; a bad file is ignored (fail open) (`codex-rs/ext/skills/src/loader/metadata.rs:L27-L35,L83-L84,L130-L139`). [OBSERVED]
- Roots: repo `.codex/skills` per project layer and `.agents/skills` in each directory from project root to cwd; user `$CODEX_HOME/skills` and `~/.agents/skills`; system skills in `$CODEX_HOME/skills/.system`; admin `/etc/codex/skills`; plugin roots; client extra roots as User scope (`codex-rs/ext/skills/src/host_roots.rs:L48-L131,L137-L185`; `codex-rs/app-server-protocol/src/protocol/v2/plugin.rs:L40-L42`). Merge dedupes by path only, keeps same-name skills, sorts Repo<User<System<Admin (`codex-rs/ext/skills/src/loader/host_merge.rs:L232-L249,L262-L269`). [OBSERVED]
- Tests: `layer_roots_preserve_scope_precedence_and_disabled_projects` (`codex-rs/ext/skills/src/host_roots_tests.rs:L244-L290`) would fail if a disabled project layer stopped yielding a Repo root; `resolved_config_and_repo_roots_preserve_order_and_dedupe_paths_not_names` (`:L597-L660`) would fail if same-name skills were merged. [TEST]
- Limits: name at most 64 chars (`parser.rs:L4,L82`); `description` need only be non-empty at load (`parser.rs:L83-L85`) and is cut to 1,024 chars when rendered (`codex-rs/ext/skills/src/render.rs:L23,L1091-L1109`); depth 6, 2,000 dirs, 20,000 entries per root (`codex-rs/ext/skills/src/loader/mod.rs:L31-L32`; `loader/discovery.rs:L17`); the loader applies no explicit byte cap to `SKILL.md` (`loader/host.rs:L363-L367`; `ReadFileOptions` defaults not inspected). [OBSERVED]
- General vs local: home-directory roots are local-agent shaped; frontmatter plus bounded catalog is general. [INFERENCE]
- Audit harness: skills become tenant-store records with owner, version and digest; no directory, hidden-dir or symlink walk. [INFERENCE]
- Recommendation: IMPLEMENT INDEPENDENTLY. Keep the SKILL.md shape for portability; drop filesystem discovery. [INFERENCE]

### F2. Skill admission and trust
- Problem: decide which skills can reach the model. [INFERENCE]
- Code: `[skills]` has `include_instructions` (default true), `max_context_tokens`, `bundled.enabled` and `[[skills.config]]` enable/disable rules by name or path; rules are read only from User and SessionFlags layers (`codex-rs/config/src/skills_config.rs:L18-L60,L149-L186`; default at `codex-rs/core/src/config/mod.rs:L4015-L4019`). The admin layer `ConfigRequirementsToml` has no skills field; it has `additional_developer_instructions`, `allow_managed_hooks_only`, `hooks`, `mcp_servers`, `plugins` (`codex-rs/config/src/config_requirements.rs:L1029-L1077`). [OBSERVED]
- Trust gap: project trust gates "project-local config, hooks, and exec policies" (`codex-rs/config/src/loader/mod.rs:L1090-L1108`); skills and AGENTS.md are not listed. Repo skill roots come from `all_layers_high_to_low`, which includes disabled layers (`host_roots.rs:L80`; `codex-rs/config/src/state.rs:L615-L629`). Project-local config may not set base URLs, providers, `notify` or `otel`, and nothing else is denied (`loader/mod.rs:L84-L101`). [OBSERVED]
- No integrity: the bundled installer defaults to ref `main`; it checks zip-slip, absolute paths, overwrite and `SKILL.md`, but has no hash or signature (`codex-rs/skills/src/assets/samples/skill-installer/scripts/install-skill-from-github.py:L19,L108-L119,L193-L195,L221-L223`). System-skill reinstall is skipped on a `DefaultHasher` marker; files are not verified (`codex-rs/skills/src/lib.rs:L84-L99,L110-L122`). Contrast: plugin git sources require `HEAD == requested SHA` (`codex-rs/core-plugins/src/loader.rs:L1865-L1872`). [OBSERVED]
- Skill-declared MCP dependencies: a mentioned skill whose `openai.yaml` lists `dependencies.tools` of type `mcp` triggers a policy check, an "Install MCP servers?" prompt and a write of the server, including a stdio `command`, to global config, then OAuth login (`codex-rs/core/src/mcp_skill_dependencies.rs:L40-L83,L86-L113,L148-L155,L256-L335,L443-L455`). The prompt is skipped when approval is `Never` and the profile has full disk write (`codex-rs/codex-mcp/src/mcp/mod.rs:L91-L110`). First-party clients only; feature `skill_mcp_dependency_install` is on by default (`mcp_skill_dependencies.rs:L48-L60`; `codex-rs/features/src/lib.rs:L1595-L1600`). [OBSERVED]
- Tests: `codex_delegate_rejects_skill_mcp_dependency_installation_without_prompting` (`codex-rs/core/tests/suite/codex_delegate.rs:L257-L342`) would fail if a restricted review delegate prompted or dropped the skill; it also shows a workspace `.agents/skills` skill loads with no trust step. `test_rejects_symlink_to_file_outside_skill` (`codex-rs/skills/tests/test_skill_installer.py:L109`) would fail on a symlink escape; `materialize_git_source_rejects_sha_that_resolves_to_hostile_default_branch` (`codex-rs/core-plugins/src/loader_tests.rs:L887`) would fail on an unpinned SHA. No test of the main install path found. [TEST]
- Limits: `products` is applied at merge (`host_merge.rs:L149-L153`) though a TODO says otherwise (`codex-rs/skills/src/model.rs:L65-L66`); `allow_implicit_invocation: false` only hides the catalog entry (`codex-rs/ext/skills/src/provider/host.rs:L144-L149`). [OBSERVED]
- General vs local: assumes one user who owns the machine and the repo. [INFERENCE]
- Audit harness: admission is an allow-list of tenant-approved, hash-pinned skill versions; a skill must never change tool or integration configuration. [INFERENCE]
- Recommendation: DO NOT ADOPT. Admission is flags over unpinned, repo-controlled files. [INFERENCE]

### F3. Skill loading, selection and execution
- Problem: keep context small but let the user or the model use a skill. [INFERENCE]
- Catalog: a developer-role fragment of kind `skills.catalog`, sized to 2% of the context window (or `max_context_tokens`, capped at 10,000; else 8,000 chars); each description at most 1,024 chars (`codex-rs/ext/skills/src/extension.rs:L189-L248`; `fragments.rs:L39-L59`; `render.rs:L19-L29,L126-L152,L1086-L1109`). The usage text says: use a skill when named or when the task "clearly matches"; read `SKILL.md` completely; do not delegate that read (`codex-rs/ext/skills/src/catalog_prompt.rs:L24-L40`). [OBSERVED]
- Selection: `$name`, `[$name](path)` or a structured `UserInput::Skill` in the user's input; a plain name needs exactly one match and no connector clash; a structured input blocks the plain-name fallback (`codex-rs/skills/src/selection.rs:L42-L109,L164-L196`; `codex-rs/skills/src/mentions.rs:L79-L112`). Guardian-generated input is never scanned for mentions (`codex-rs/core/src/session/turn.rs:L1039-L1044`). [OBSERVED]
- Injection: the body is read at mention time and recorded as a user-role `<skill><name/><path/>body</skill>` item after the user input, verbatim and unescaped (`fragments.rs:L61-L111`; `turn.rs:L368-L378,L398-L405,L1083-L1101`). Two paths exist (extension `TurnInputContributor`, core `load_skill_prompts`); core skips prompts the extension injected (`turn.rs:L1094-L1101,L1155-L1166`). The extension path cuts bodies at 8,000 bytes (`extension.rs:L477-L501`); the core path cuts only agent-plugin skills, so ordinary host skills are uncapped (`host_prompt.rs:L76-L97`). [OBSERVED]
- Self-selection and scripts: the model may read a listed `SKILL.md` with shell tools; Codex detects script runs and reads afterwards, for telemetry only (`codex-rs/skills/src/invocation.rs:L26-L43,L79-L109`; `codex-rs/core/src/skills.rs:L121-L200`). Scripts use the normal exec tool and sandbox. Executor and cloud skills use `skills.read` (`ext/skills/src/tools/mod.rs:L56-L71`). [OBSERVED]
- Tests: `collect_explicit_skill_mentions_skips_ambiguous_name` (`codex-rs/skills/src/selection_tests.rs:L228`) and `..._skips_invalid_structured_and_blocks_plain_fallback` (`:L169`) would fail if an ambiguous or invalid mention fell back to a guess; `restricted_executor_skill_is_listed_only_when_permitted` and `..._rejects_reference_until_permission_approved` (`codex-rs/app-server/tests/suite/v2/executor_skills.rs:L71,L76`) would fail if executor skills ignored filesystem permissions. [TEST]
- General vs local: progressive disclosure and explicit mention are general; model self-selection is prompt-only. [INFERENCE]
- Audit harness: the platform selects methodology steps from the engagement's approved set and records the digest; self-selection becomes a recorded tool call. [INFERENCE]
- Recommendation: ADOPT PATTERN. Bounded catalog, explicit-mention injection, ambiguity refusal. [INFERENCE]

### F4. Versioning, cache and reload
- Problem: pick up skill edits without a restart. [INFERENCE]
- Code: no version or hash on a skill; identity is the canonical path. Two caches (by cwd, by config key, 32 entries) live in `HostSkillsService` (`host_service.rs:L41,L87-L88,L330,L375-L395`); the snapshot is rebuilt per turn context (`codex-rs/core/src/session/turn_context.rs:L1207-L1230`). `SkillsWatcher` watches local roots only, throttles to 10 s, ignores `.system`, clears the cache and sends `SkillsChanged` (`codex-rs/app-server/src/skills_watcher.rs:L25-L28,L108-L110,L154-L167`). `skills/list` has `forceReload` (`plugin.rs:L20-L28`). [OBSERVED]
- Bodies are re-read from disk at each mention (F3), so text can change between turns. The catalog and a blake3 fingerprint are kept in world state only to avoid re-announcing ("display history, not execution authority") (`codex-rs/ext/skills/src/world_state.rs:L28-L37,L45-L60`). [OBSERVED]
- General vs local: hot reload suits an editor loop. [INFERENCE]
- Audit harness: a Run binds immutable skill versions at start and never re-reads mid-Run. [INFERENCE]
- Recommendation: IMPLEMENT INDEPENDENTLY. Content-addressed versions pinned per Run. [INFERENCE]

### F5. AGENTS.md and instruction providers
- Problem: give the agent project and user rules. [INFERENCE]
- Discovery: walk up from cwd to the first `project_root_markers` hit (default `.git`; Project layers are ignored when computing markers); per directory take the first of `AGENTS.override.md`, `AGENTS.md`, `project_doc_fallback_filenames`; concatenate root to cwd (`codex-rs/core/src/agents_md.rs:L1-L18,L191-L296`). Global `$CODEX_HOME/AGENTS.override.md|AGENTS.md` comes first, then thread instructions, then project files joined by `--- project-doc ---` (`codex-rs/codex-home/src/instructions/mod.rs:L40-L84`; `agents_md.rs:L47-L49,L386-L419`). [OBSERVED]
- Budget and trust: `project_doc_max_bytes` defaults to 32 KiB, shared across environments; a file is read in full then cut in memory (lossy UTF-8); only `tracing::warn!` records the cut; the global file has no cap (`codex-rs/config/src/config_toml.rs:L75`; `agents_md.rs:L142-L179`). Project docs are skipped only when trust is explicitly `untrusted` (`agents_md.rs:L64-L66`; `config_toml.rs:L612-L614`). [OBSERVED]
- State: `AgentsMdManager` owns a 1-permit refresh semaphore and a mutex over `{instructions, cache}`; providers run outside the state lock; a failed refresh keeps the last good value; a changed environment or trust level clears the cache first (`codex-rs/core/src/agents_md_manager.rs:L21-L46,L61-L144`). `ThreadInstructionsProvider` sits between global and repository text, is capped at 10,000 estimated tokens, is read at each model request and may be shared with sub-agents (`codex-rs/ext/extension-api/src/user_instructions.rs:L35-L70`; `agents_md_manager.rs:L165-L178`). [OBSERVED]
- Tests: `untrusted_project_excludes_project_instructions` (`codex-rs/core/tests/suite/agents_md.rs:L646-L691`) would fail if project text leaked under `untrusted`; `doc_larger_than_limit_is_truncated` (`codex-rs/core/src/agents_md_tests.rs:L668`) pins the cut; `thread_provider_enforces_its_own_limit_before_startup_and_sampling` (`agents_md.rs:L1392-L1508`) would fail if an oversize value were accepted; `thread_provider_lives_with_its_session_across_resume` (`:L1646-L1733`) would fail if resume re-read a provider; `isolated_guardian_keeps_applied_thread_instructions` (`:L1323-L1390`) would fail if the reviewer read newer text than the parent applied. [TEST]
- General vs local: the repo walk is local; snapshot manager and providers are general. [INFERENCE]
- Audit harness: instruction text comes from a tenant or engagement record; a provider returns a versioned, hashed snapshot; oversize input fails instead of truncating. [INFERENCE]
- Recommendation: ADAPT IDENTIFIED CODE. Port the manager and provider pattern (serialised refresh, last good value, size refusal, snapshot for reviewers); drop the file walk. [INFERENCE]

### F6. Layering and precedence
- Problem: many sources address the model; which one wins? [INFERENCE]
- Base prompt (API `instructions`, or a developer message on responses-lite models): first of `base_instructions`, `model_instructions_file`, config `instructions`; else the persisted session value; else the model-catalog template (`codex-rs/core/src/config/mod.rs:L3994-L4009`; `codex-rs/core/src/session/mod.rs:L713-L748`; `codex-rs/core/src/client.rs:L902-L939`). The catalog (bundled `models.json`, or network-refreshed) also owns approvals, permissions, guardian and confirmation text (`codex-rs/models-manager/src/lib.rs:L15`; `manager.rs:L88-L95`; `codex-rs/prompts/src/model_messages.rs:L60-L72`). [OBSERVED]
- Initial context order: one aggregated developer message (config `developer_instructions`, extension fragments including the skills catalog, world-state sections); separate developer messages; one contextual USER message (AGENTS.md, environment); admin `additional_developer_instructions` last (`codex-rs/core/src/session/mod.rs:L4222-L4454`). Per turn: user text, `UserPromptSubmit` context (developer), then skill/plugin bodies (user) (`turn.rs:L368-L405`). Client `additional_context`: `Application` to developer, `Untrusted` to user text tagged `<external_key>`, each value cut to 1,000 tokens (`codex-rs/core/src/state/additional_context.rs:L16-L34`; `codex-rs/context-fragments/src/additional_context.rs:L6-L102`). [OBSERVED]
- Explicit precedence is prose: nested AGENTS.md wins; system/developer/user instructions beat AGENTS.md (`codex-rs/protocol/src/prompts/base_instructions/default.md:L17-L27`); the user's instruction "must take precedence over any guidelines provided in skills or external files" (`codex-rs/models-manager/models.json:L76,L251,L426,L594`; weaker wording at `:L771,L913,L1051,L1189,L1306,L1543`); collaboration mode changes only through developer instructions (`codex-rs/collaboration-mode-templates/templates/default.md:L5`). The default prompt says AGENTS.md is "included with the developer message"; code sends a user-role message (`default.md:L27`; `codex-rs/core/src/context/user_instructions.rs:L15-L25`). [OBSERVED]
- Typed authority: each fragment declares role, `ContentItemKind` and markers; user-authorization checks read kind metadata, not text (`codex-rs/core/src/context/contextual_user_message.rs:L51-L82`). Managed text is limited to 10,000 tokens, rendered separately, and snapshotted as a hash with replacement and removal notices (`codex-rs/core/src/context/world_state/managed_developer_instructions.rs:L13-L78,L103-L140`). [OBSERVED]
- Tests: I did not search for tests that pin the precedence sentences. [INFERENCE]
- General vs local: role placement is general; the prose is model-specific. [INFERENCE]
- Audit harness: precedence must be structural and recorded: firm methodology (managed) over engagement instructions over skill over user text over retrieved data. "User beats skills" would invert a firm's methodology. [INFERENCE]
- Recommendation: ADOPT PATTERN. Role-typed fragments, managed text last, hierarchy written in code and tests. [INFERENCE]

### F7. Hooks as instruction sources
- Problem: let operators inject context or veto actions. [INFERENCE]
- Code: 12 events (`codex-rs/hooks/src/lib.rs:L9-L22`); handler kinds command and MCP tool; `prompt` and `agent` handlers are skipped with a warning (`codex-rs/hooks/src/engine/discovery.rs:L635-L654`). Command hooks read JSON on stdin (`session_id`, `cwd`, `tool_name`, `tool_input`, `prompt`, ...) and return JSON: `continue`, `decision`, `reason`, `systemMessage`, and `hookSpecificOutput` with `additionalContext`, `permissionDecision`, `updatedInput`, `updatedMCPToolOutput` (`codex-rs/hooks/schema/generated/*.schema.json`). [OBSERVED]
- Model effect: `additionalContext` becomes a developer-role message with no wrapper and no source id (`codex-rs/core/src/context/hook_additional_context.rs:L4-L35`; `codex-rs/core/src/hook_runtime.rs:L849-L873`). Default limit 2,500 tokens; longer text is written in full to `<tmp>/hook_outputs/<thread>/<uuid>.txt` and replaced by a preview; a limit of 0 disables the cut (`codex-rs/hooks/src/output_spill.rs:L11-L12,L53-L91`). [OBSERVED]
- Trust: identity hash is SHA-256 of sorted-key JSON of the normalised handler (`discovery.rs:L766-L792`; `codex-rs/config/src/fingerprint.rs:L54-L66`); status Managed, Trusted, Modified or Untrusted; only enabled Managed or Trusted handlers run unless `bypass_hook_trust` (`discovery.rs:L713-L734,L794-L821`); managed hooks come from system, MDM and cloud layers (`discovery.rs:L823-L839`). Project layers also need project trust (F2). [OBSERVED]
- Tests: `config_batch_write_updates_hook_trust_for_loaded_session` (`codex-rs/app-server/tests/suite/v2/hooks_list.rs:L1389-L1590`) would fail if an edited hook kept running or was not shown as Modified; `allow_managed_hooks_only_in_config_toml_does_not_enable_policy` and `allow_managed_hooks_only_skips_unmanaged_json_and_toml_hooks` (`codex-rs/hooks/src/engine/mod_tests.rs:L1210,L1268`) would fail if user config could set the policy; `additional_context_messages_stay_separate_and_ordered` (`hook_runtime.rs:L1105`). [TEST]
- General vs local: hash trust and typed schemas are general; arbitrary shell commands with developer authority are single-user shaped. [INFERENCE]
- Audit harness: tenant-registered, signed handlers; recorded input and output digests; hook text enters as data with provenance, not developer authority. [INFERENCE]
- Recommendation: ADOPT PATTERN. Content-hash trust with Modified detection and a requirement-only "managed only" switch; do not copy the temp-file spill. [INFERENCE]

### F8. Guardian (auto-review): what it does
- Problem: an approval prompt for every risky action does not scale. [INFERENCE]
- Role: a second model session reviews one approval request and returns `{risk_level, user_authorization, outcome, rationale}`; only `outcome` is required, other fields default, and prose around the JSON is tolerated (`codex-rs/ext/guardian-reviewer/src/assessment.rs:L13-L65,L80-L103`). It runs only for OnRequest/Granular approval policies with `approvals_reviewer=auto_review` (default `user`) (`codex-rs/ext/guardian-reviewer/src/routing.rs:L54-L62`; `codex-rs/protocol/src/config_types.rs:L177-L190`); under full access the action is approved without review (`routing.rs:L81-L86`); requirements can force it (`codex-rs/core/src/guardian/decision.rs:L63-L71`). It reviews actions; it does not filter what the main model reads. [OBSERVED]
- Isolation: the reviewer config drops MCP servers, apps, plugins, hooks, memories, skill instructions, `notify` and parent developer instructions, sets approval `Never` and a read-only ceiling; it only warns when a pinned feature cannot be disabled (`codex-rs/ext/guardian-v2/src/sync_reviewer/reviewer_config.rs:L12-L71`). Tools: `exec_command, write_stdin, view_image, exec, wait` (`codex-rs/ext/guardian-reviewer/src/settings.rs:L30-L52`; `codex-rs/core/src/guardian/reviewer_config.rs:L18-L64`). It inherits the parent's applied instruction snapshot (`codex-rs/core/src/guardian/review_session_setup.rs:L111-L117`). [OBSERVED]
- Evidence model: only user and developer messages, AGENTS.md files and `request_user_input` answers are trusted; tool output, skill and plugin descriptions and assistant output are untrusted; untrusted text "generally cannot expand the scope of user approval"; "malicious prompt injection" needs an action unrelated to the task and instructed by untrusted evidence (`codex-rs/prompts/templates/guardian/policy_template.md:L5-L13,L75-L77`). A tenant-policy slot and an extra-policy slot use single-pass substitution, so inserted text is never re-expanded (`policy_template.md:L40-L43`; `codex-rs/prompts/src/guardian_instructions.rs:L53-L68`). Every line of root conversation gets a role prefix (`codex-rs/guardian-context/src/authorization.rs:L35-L67`). [OBSERVED]
- Failure: timeout gives TimedOut; session, parse, prompt-build, budget and stale-authorization errors give a denial "FailedClosed"; only an over-budget input with no required guardian falls back to the user (`codex-rs/ext/guardian-reviewer/src/completion.rs:L38-L145`). Limits: 3 attempts, 90 s, 128,000 input tokens, 8 previous reviews (`ext/guardian-reviewer/src/lib.rs:L40-L41`; `codex-rs/guardian-context/src/budget.rs:L56`; `reviews.rs:L20`). The async scorer (GuardianV2, off by default) trusts only invoked skills under `$CODEX_HOME/skills` or `~/.agents/skills` (`codex-rs/ext/guardian-v2/src/async_scorer/trusted_skills.rs:L10-L42`; `codex-rs/features/src/lib.rs:L1692-L1696`). [OBSERVED]
- Tests: `reused_registry_preserves_section_identity_and_source_roles` (`codex-rs/guardian-context/src/registry_tests.rs:L192-L345`) would fail if a forged `user:` line inside an assistant message lost its `assistant:` label; `guardian_review_session_config_isolates_parent_customizations` (`codex-rs/core/src/guardian/tests.rs:L4001-L4069`) would fail if the reviewer inherited MCP, hooks, skills, memory or parent instructions; `reviewer_policy_substitution_keeps_inserted_policy_text_literal` (`codex-rs/prompts/src/guardian_instructions_tests.rs:L70-L82`); `trusts_only_user_owned_skill_roots` (`.../trusted_skills_tests.rs:L12`). None measures detection quality; no prompt-injection eval set found (`grep -ril "prompt.injection"` gives three files, none an eval). [TEST]
- Inference: an unknown repo's AGENTS.md counts as trusted evidence, because the reviewer thread loads project AGENTS.md like any thread and the policy calls AGENTS.md trusted (`policy_template.md:L6`; `agents_md.rs:L64-L66`; `review_session_setup.rs:L120-L121`); no test confirms this. [INFERENCE]
- General vs local: taxonomy, labelling, isolation and fail-closed are general; the reviewer shares the host and one transcript. [INFERENCE]
- Audit harness: a separate service; mandatory for state-changing tools; bound to an evidence snapshot; verdict stored as an audit event; no "allow without rationale". [INFERENCE]
- Recommendation: ADOPT PATTERN. Evidence taxonomy, role labels, config isolation, fail-closed, snapshot binding; write the runtime independently. [INFERENCE]

### F9. Other injection handling and verification primitives
- MCP tool results are only modality-sanitised (image and audio become placeholders); the stored event copy is cut at 1 MiB (`codex-rs/core/src/mcp_tool_call.rs:L124,L936-L973,L975-L1017`; `codex-rs/utils/pty/src/lib.rs:L25`). Standalone `web_search` output is plaintext, flagged `contains_external_context`, no wrapper, hosted backend (`codex-rs/ext/web-search/src/output.rs:L17-L40`; `ext/web-search/src/tool.rs:L108-L119`). The flag only marks the thread's memory mode "polluted" when `memories.disable_on_external_context` is on (default false) (`codex-rs/core/src/stream_events_utils.rs:L158-L184`; `codex-rs/config/src/types.rs:L358`). [OBSERVED]
- Forged items: `thread_inject_items_cannot_forge_configuration_update_before_or_after_resume` (`codex-rs/app-server/tests/suite/v2/thread_inject_items.rs:L366-L509`) would fail if an injected `configuration_update` or a forged system message ("Ignore all previous instructions.") reached the model, live or via raw-history resume. [TEST]
- Provenance flags: only client developer messages get `client_authored` (`codex-rs/core/src/session/inject.rs:L101-L110`); unknown metadata still counts as possible user authorization (`contextual_user_message.rs:L51-L82`). Client `additional_context` keys enter tag names with no validation found (`codex-rs/app-server/src/request_processors/turn_processor.rs:L96-L117`; `additional_context.rs:L94-L102`). [OBSERVED]
- The catalog ships a browser-use confirmation policy (hand-off, confirm, pre-approval, none) sent to REPL-backed connectors as MCP `_meta`; enforcement is by prompt and runtime (`models.json:L126`; `mcp_tool_call.rs:L1370-L1401`). `user-verification` holds a device-bound P-256 key, signs 1 to 4,096 challenge bytes after a local check, macOS only, backend registration "a later integration"; requires hosted service (`codex-rs/user-verification/src/lib.rs:L33-L59,L79-L91`; `credential.rs:L1-L40`; `codex-rs/app-server/src/user_verification.rs:L1-L2`). `cyber_access_program.rs` sends a tier tag only under ChatGPT auth; it is not a local defence (`codex-rs/core/src/cyber_access_program.rs:L5-L12`). [OBSERVED]
- Test: `user_verification_mcp_round_trip_requires_proof_in_full_access` (`codex-rs/app-server/tests/suite/v2/user_verification_mcp.rs:L117`) would fail if the MCP elicitation completed without a signed proof. [TEST]
- General vs local: unframed tool output suits a supervised single user; step-up verification is general. [INFERENCE]
- Audit harness: wrap all retrieved data as untrusted with provenance; use step-up human verification for attributable decisions. [INFERENCE]
- Recommendation: IMPLEMENT INDEPENDENTLY. Take the ideas (forged-item stripping test, step-up proof), not the code. [INFERENCE]

### F10. Provenance recorded
- Persisted in the rollout: every message item (developer and `<skill>` items included), `SessionMeta` with `base_instructions` (provenance Custom or Model), `WorldState`, `TurnContext`, `RetainedContext` (`codex-rs/rollout/src/policy.rs:L10-L65`; `codex-rs/core/src/config/mod.rs:L4007-L4009`; `codex-rs/protocol/src/protocol.rs:L3167-L3170`). AGENTS.md is stored as `{directory,text}` "without filesystem provenance"; managed text as a SHA-1 hash; the skills catalog as body plus blake3 fingerprint (`codex-rs/core/src/context/world_state/agents_md.rs:L19-L24`; `world_state/mod.rs:L262-L281`; `ext/skills/src/world_state.rs:L28-L65`). Per-item `CodexHarnessMetadata` keeps `client_authored`, `harness_authored_configuration`, `inherited_user_message`, `user_input_order` (`codex-rs/history/src/lib.rs:L60-L127`). [OBSERVED]
- Clients can read `instructionSources`: file paths of global, thread and project AGENTS.md on thread start, resume and fork (`codex-rs/core/src/session/mod.rs:L1996-L2003`; `codex-rs/app-server/src/request_processors/thread_processor.rs:L1558-L1630`). The authors list non-file provenance as a TODO (`user_instructions.rs:L11-L12`). [OBSERVED]
- Not found: a persisted skill-invocation event (only telemetry `codex.skill.injected` and analytics, `core/src/skills.rs:L38-L119,L186-L200`); file hashes of `SKILL.md` or AGENTS.md; project trust level in `TurnContextItem` (`protocol.rs:L3301-L3358`); the hook that produced a context message (`hook_additional_context.rs:L4-L13`). [OBSERVED]
- General vs local: paths and rendered text suit a replay of one user's session. [INFERENCE]
- Audit harness: per turn, persist engagement id, source ids, versions, SHA-256, trust class and truncation flags; record skill selection as an event. [INFERENCE]
- Recommendation: IMPLEMENT INDEPENDENTLY. [INFERENCE]

## Hard numbers

- Skill name max: 64 chars (qualified 129) (`parser.rs:L4`; `loader/mod.rs:L22-L23`)
- Skill scan: depth 6; 2,000 dirs; 20,000 entries; 8 parallel roots (`loader/mod.rs:L18,L31-L32`; `discovery.rs:L17`)
- Catalog budget: 2% of window; cap 10,000 tokens if set; fallback 8,000 chars; description 1,024 chars (`render.rs:L19-L24,L126-L152`)
- Skill body cap: 8,000 bytes (extension path only) (`render.rs:L21`; `extension.rs:L488-L501`)
- Config skill cache: 32 entries (`host_service.rs:L41`)
- Watcher throttle: 10 s (`skills_watcher.rs:L25-L26`)
- `skills.read` / list: 512 KiB response; 2,048 B handle; 20 per page (`tools/mod.rs:L56-L57`; `tools/list.rs:L32`)
- AGENTS.md budget: 32 KiB default (`config_toml.rs:L75`)
- Thread and managed instructions: 10,000 estimated tokens each (`agents_md_manager.rs:L168`; `managed_developer_instructions.rs:L13`)
- Client context value: 1,000 tokens (`context-fragments/src/additional_context.rs:L6`)
- Hook context: 2,500 tokens default; timeout 600 s; end hooks 1 s (max 3 s) (`output_spill.rs:L12`; `discovery.rs:L742-L763`)
- Guardian: 3 attempts; 90 s; 128,000 tokens; 8 reviews; 900-token retained instructions (`guardian-reviewer/src/lib.rs:L40-L41`; `budget.rs:L56`; `reviews.rs:L20`; `retained_instructions.rs:L29`)
- Trusted skill paths (async): 16 paths; 512 B each; 2,048 B total; 768-token fragment (`trusted_skills.rs:L10-L12`; `guardian-context/src/trusted_skills.rs:L14`)

## Hosted-service dependencies (requires hosted service)

- Model catalog refresh (`Online`, `OnlineIfUncached`) can replace instruction and guardian text (`manager.rs:L88-L95`). Cloud skills need a host-registered cloud provider and the Apps MCP resources; the app-server registers only executor and host providers (`codex-rs/app-server/src/extensions.rs:L104-L120`; `ext/skills/src/cloud_skill.rs:L1-L40`).
- Standalone web search, `cyber_access_program`, `user-verification` registration, analytics, and the reviewer model.

## Conclusion for an audit harness

Keep (ADOPT PATTERN):
- Typed fragments (role, kind, markers); authority read from metadata, not text (F6, F9).
- Managed text rendered last, hashed, with replacement and removal notices (F6).
- Single-pass template substitution so policy text is never re-expanded (F8).
- Provider snapshots: serialised refresh, no lock over provider I/O, last good value, size refusal (F5).
- Progressive disclosure: bounded catalog, explicit mention, ambiguity refusal (F3).
- Content-hash trust with Modified detection; managed-only policy settable only by requirements (F7).
- Guardian evidence taxonomy, role labels, config isolation, fail-closed, reviewer on the applied snapshot, forged-item test (F8, F9).

Change:
- Persist a per-turn instruction manifest (engagement, source id, version, SHA-256, trust class, truncation flag). Codex persists text and paths, fingerprints with SHA-1, blake3 and `DefaultHasher`, and re-reads skill files at each mention (F4, F10).
- Pin skill and instruction versions per Run; no hot reload mid-Run (F4).
- Refuse or flag truncation; cap every source, including the global file and host skills (F3, F5).
- Make guardian-style review mandatory, evidence-bound and stored, not opt-in and skipped under full access (F8).
- Frame MCP, web and target-system output as untrusted data with provenance (F9).
- Validate client context keys; enforce a per-skill tool allow-list in the harness (F1, F9).

Refuse:
- Repo-local or target-system content as instruction or skill source, and discovery from disabled or untrusted layers (F2).
- Skill-declared dependency install that writes configuration (F2).
- Unpinned installers and runtime marketplaces (F2).
- Hook stdout with developer authority and temp-file spill (F7).
- Instruction text supplied by an unpinned hosted catalog (F6).

Zobba note [INFERENCE]: the project CLAUDE.md already describes frozen prompt versions, frozen plan digests, untrusted-text rendering and audited rejection of model proposals; Codex has no equivalent of those.

## Coverage and limits

- Not read in detail: `codex-rs/ext/skills/src/selection.rs` (extension selector), `ext/skills/src/tools/{read,list,schema}.rs`, `dynamic_skill_selector/*`.
- Not opened: tests for the skills watcher, host cache, `render_tests.rs`, `skills_list.rs`, `selected_capability_stack.rs`, `model_instructions_tests.rs`; I did not search for tests that pin the precedence sentences.
- Selected capability roots (`codex-rs/protocol/src/capabilities.rs:L8-L36`; `SessionMeta`, `protocol.rs:L3177-L3179`) are the platform-selected analogue of tenant skills; I read only the type and test names.
- Guardian: not read: async scorer beyond trusted skills, `transcript.rs`, `enforcement.rs`, `images.rs`, `node_repl.rs`, GuardianV2 classifier text.
- Hooks: MCP-tool runner, `output_parser.rs` not read; schemas were enumerated with a script.
- No test was run; every [TEST] line says what the test would detect, not that it passes. Docs in the repo are pointers to hosted pages (`docs/agents_md.md:L1-L3`, `docs/skills.md:L1-L3`) [DOC].

## Reuse candidates

Zobba is a TypeScript monorepo, so Rust crates serve as specification and test source, not dependencies. Licence for all crates below: Apache-2.0 (`codex-rs/Cargo.toml:L167`); keep NOTICE text when porting; sample skills carry their own Apache-2.0 files (`codex-rs/skills/src/assets/samples/*/LICENSE.txt`).

- `codex-skills`: `parser.rs`, `mentions.rs`, `selection.rs`, `name_counts.rs`. Dependencies: codex-protocol, codex-shell-command, codex-utils-absolute-path, codex-utils-path-uri, include_dir, serde, serde_yaml, shlex, thiserror, tracing. Coherence: High for the pure modules. Change: Port rules and tests to TypeScript.
- `codex-skills-extension`: `render.rs`, `catalog_prompt.rs`. Dependencies: blake3, codex-config, codex-exec-server, codex-mcp, codex-analytics, tokio, more. Coherence: Low as a crate. Change: Reimplement the budget and omission marker.
- `codex-context-fragments`. Dependencies: codex-protocol, codex-utils-string, serde_json. Coherence: High; small trait. Change: Port the fragment trait (role, kind, markers); add hashing.
- `codex-guardian-context`. Dependencies: codex-context-fragments, codex-history, codex-protocol, serde_json. Coherence: Medium; needs rollout types. Change: Port `GuardianRootMessage::render`, section scopes, registry tests.
- `codex-hooks`: trust logic in `engine/discovery.rs`. Dependencies: codex-config, codex-plugin, codex-protocol, tokio, regex, uuid, more. Coherence: Medium; trust code is small. Change: Port `hook_hash`, `hook_trust_status`; drop spill and shell runner.
- `codex-prompts`: guardian templates, `guardian_instructions.rs`. Dependencies: codex-context-fragments, codex-guardian-context, codex-utils-template, more. Coherence: High. Change: Replace policy text; keep single-pass substitution and its test.
- `codex-user-verification`. Dependencies: base64, p256, sha2, thiserror, tracing (macOS: objc2, security-framework). Coherence: High; macOS only. Change: Design reference only.
