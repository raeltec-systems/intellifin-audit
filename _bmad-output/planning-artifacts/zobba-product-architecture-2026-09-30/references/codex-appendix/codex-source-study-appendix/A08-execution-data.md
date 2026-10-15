# 08 — Execution and data handling (Codex @ 8ffd91e42aa001b7e897bea812b02f89264f9fa0)

All paths are relative to the Codex repository root. All line numbers are at the pinned commit. No test was run.

## Summary (10 lines)

1. The model runs commands through "unified exec". `exec_command` starts a process with pipes (the default) or a PTY. It waits for a *yield* window (default 10 s, clamped to 250 ms–30 s) and returns the output. If the process is still running, it also returns a `session_id` that `write_stdin` uses to poll or send input.
2. An interactive process has **no wall-clock limit**. It stays in a per-session store of up to 64 entries (LRU pruning, with the 8 most recently used protected) across turns and interrupts. It ends only on session shutdown, an explicit terminate, pruning, or `Drop`, and for a local process each of these sends SIGKILL to its process group (an exec-server process gets a remote terminate).
3. The one-shot variant (used only when managed config disables unified exec) and the internal `exec()` path do enforce timeouts (default 10 s). A timeout sends SIGKILL to the group and reports exit code 124. On the `exec()` path a cancellation sends SIGTERM, waits 50 ms, then sends SIGKILL; the one-shot variant sends SIGKILL at once.
4. Output is read concurrently. Unified exec keeps it in a 1 MiB head/tail buffer; the `exec()` path keeps a 1 MiB prefix per stream. Each call streams at most 10,000 base64 delta events. The model gets about 10k tokens (estimated as bytes/4), with explicit omission markers.
5. Output can be lost silently in five ways: broadcast lag drops chunks, a drain timeout throws away buffered output, a child killed by a signal returns an error with no output, serde drops tool `success` metadata, and output decoding is lossy.
6. By default, children inherit the whole parent environment, including `*KEY*/*SECRET*/*TOKEN*` variables. Only five named launch variables are always removed.
7. `apply_patch` is dry-run-verified before approval, then re-applied from the patch text. It applies files one after another and is not atomic. It reports a committed-delta with an "exact" flag instead of rolling back, and each write truncates the file before writing.
8. The remote exec-server numbers output chunks, keeps a bounded replay buffer (1 MiB or 50k chunks) and can resync with `read(after_seq)`. This is the most reusable design for a durable server harness.
9. No CPU, memory or process-count limits apply to children. Containment relies on setsid/process groups, `PR_SET_PDEATHSIG`, kill-on-drop, a reaper thread and, when sandboxed on Linux, bwrap `--die-with-parent --unshare-pid`.
10. Adopt: the head/tail buffer, the seq-numbered output log, the process-group discipline and the omission accounting. Build durable, attributable execution records, hard limits and atomic writes independently.

## 1. Execution paths

| Path | Entry | Termination limit | Retention | Used by |
|---|---|---|---|---|
| Unified exec (interactive) | `ExecCommandHandler::new` `codex-rs/core/src/tools/spec_plan.rs:L1108-L1110` | none on the process; yield only | 1 MiB head/tail | model tools `exec_command`/`write_stdin`; feature `unified_exec` is Stable and on by default (`codex-rs/features/src/lib.rs:L991-L996`) |
| One-shot `exec_command` | `codex-rs/core/src/tools/spec_plan.rs:L1111-L1116`, `codex-rs/core/src/unified_exec/oneshot.rs:L41-L122` | `timeout_ms`, default 10,000 (`codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs:L312-L320`) | 1 MiB head/tail | only when managed requirements disable unified exec |
| `exec()` | `codex-rs/core/src/exec.rs:L921-L977` via `codex-rs/core/src/sandboxing/mod.rs:L205-L210` | `ExecExpiration`, default 10 s | 1 MiB per stream | shell-snapshot validation (`codex-rs/core/src/shell_snapshot_sandbox.rs:L196-L202`), app-server `command/exec`, user `!cmd` (1 h, `codex-rs/core/src/tasks/user_shell.rs:L48`) |
| exec-server | `codex-rs/exec-server/src/local_process.rs:L424` | client-driven terminate | 1 MiB / 50k chunks | remote environments and snapshot-backed launches (`codex-rs/core/src/unified_exec/process_manager.rs:L1322-L1357`) |
| apply_patch | `codex-rs/core/src/tools/runtimes/apply_patch.rs:L168-L237` | n/a | n/a | the `apply_patch` tool and heredocs intercepted from `exec_command` (`exec_command.rs:L378-L405`) |

## 2. Findings

### F1. Process start and process-tree containment

- **Problem.** Commands start descendants. Those descendants must not grab a TTY, hang the agent, or outlive it. [INFERENCE]
- **Code and state ownership.**
  - The `exec()` path uses `spawn_child_async` (`codex-rs/core/src/spawn.rs:L52-L142`). It removes non-inheritable variables (L64), then calls `env_clear()` and `envs` (L88-L89). [OBSERVED]
  - Its `pre_exec` hook calls `detach_from_tty` (setsid, with a fallback to `setpgid` on EPERM; `codex-rs/utils/pty/src/process_group.rs:L51-L61`). On Linux it also sets `PR_SET_PDEATHSIG=SIGTERM` and re-checks the parent to close a race (L29-L41). stdin is `/dev/null` so tools cannot block on it (`spawn.rs:L123-L132`), and the child has `kill_on_drop(true)` (L141). [OBSERVED]
  - Unified exec uses `codex_utils_pty::Command`. It starts from `env_clear`, defaults to `kill_on_drop(true)` and pipes all three stdio streams (`codex-rs/utils/pty/src/child_command.rs:L94-L126`); the pipe backend overrides the drop policy to `ReapOnly` and leaves termination to `killpg` (`child_command.rs:L174-L182`). [OBSERVED]
  - Pipe children use `ProcessMode::NewSession`, `DescriptorPolicy::Explicit` (unrelated fds are closed), parent-death termination and `ReapOnly` (`codex-rs/utils/pty/src/pipe.rs:L149-L171`). The kill is `killpg(SIGKILL)` on the stored PGID (`pipe.rs:L69-L73` → `process_group.rs:L269-L271`). [OBSERVED]
  - A PTY child is a session leader (PID == PGID). It is killed through the group and through the direct killer (`codex-rs/utils/pty/src/pty.rs:L73-L111`, `L212-L217`). [OBSERVED]
  - Dropped children go to one `codex-child-reaper` thread. It runs `waitpid(WNOHANG)` on batches of 64 (`codex-rs/utils/pty/src/child_reaper.rs:L22-L65`). [OBSERVED]
  - On Linux, setup runs in a single-threaded re-exec of `/proc/self/exe --codex-run-as-process-setup`, so the multithreaded server is never forked (`codex-rs/utils/pty/src/spawn_helper.rs:L1-L7`, `L31-L35`; called at `pipe.rs:L176-L180`). [OBSERVED]
- **Tests.**
  - `pty_terminate_kills_background_children_in_same_process_group` (`codex-rs/utils/pty/src/tests.rs:L1327-L1375`) fails if a `sleep 1000 &` survives `terminate()`. [TEST]
  - `pipe_terminate_reaps_child` and `pipe_drop_reaps_child` (L832, L856) detect zombies. [TEST]
  - `kill_child_process_group_kills_grandchildren_on_timeout` (`codex-rs/core/src/exec_tests.rs:L1272-L1337`) fails if a grandchild outlives a 500 ms timeout. [TEST]
- **Limits.**
  - Children get no rlimits or cgroups. A grep for `setrlimit|RLIMIT_|prlimit|cgroup` finds only `RLIMIT_CORE=0` for Codex itself (`codex-rs/process-hardening/src/lib.rs:L109`). [OBSERVED]
  - A descendant that calls setsid escapes `killpg`. PDEATHSIG reaches only the direct child. [INFERENCE]
- **General or local.** Process-group discipline, the reaper and fd hygiene are general. The fork-avoiding helper matters mainly for servers. [INFERENCE]
- **Audit harness.** Needs per-tenant cgroups (CPU, memory, pids), a cgroup kill for full teardown, and a spawn record persisted before exec. [INFERENCE]
- **Recommendation.** ADOPT PATTERN. The setsid + killpg + reaper + explicit-fd approach is sound; add cgroup limits.

### F2. Timeout and termination semantics on the `exec()` path

- **Problem.** Bounded commands need a reliable result. [INFERENCE]
- **Code.**
  - The limit is `ExecExpiration{Timeout,DefaultTimeout,Cancellation,TimeoutOrCancellation}` (`codex-rs/core/src/exec.rs:L152-L160`), with `DEFAULT_EXEC_COMMAND_TIMEOUT_MS = 10_000` (L63). [OBSERVED]
  - `consume_output` starts one task for stdout and one for stderr (L1003-L1014). It then races `child.wait()`, the expiration and `ctrl_c` (L1026-L1082). [OBSERVED]
  - **Timeout:** SIGKILL to the group plus `start_kill`, with a synthetic status of 128+64 (L1034-L1041). `finalize_exec_result` treats signal 64 as a timeout, sets exit code 124 and returns `Err(SandboxErr::Timeout{output})` with the captured output (L795-L825). [OBSERVED]
  - **Cancellation:** SIGTERM to the group, a 50 ms grace (L71), then SIGKILL. The reported exit code is 1 (L1042-L1073). [OBSERVED]
  - **Codex receives SIGINT:** SIGKILL, reported as signal 9 (L1077-L1081). [OBSERVED]
  - **Any other signal** gives `Err(SandboxErr::Signal(sig))` with no output at all (L795-L800). [OBSERVED]
  - After exit, each reader gets `IO_DRAIN_TIMEOUT_MS = 2_000` (L94). If that expires, the task is aborted and an *empty* stream is returned (L1087-L1105). [OBSERVED]
  - Because `read_output` owns its buffer (L1199-L1246), aborting the task discards the bytes it already read. [INFERENCE]
  - Only the FullBufferWithExpiration and SensitiveFullBuffer policies kill the group when the drain fails (L1149-L1161). The default ShellTool branch does not (L1177-L1180), so a background grandchild that holds the pipe keeps running. [INFERENCE]
  - Duration is measured around the whole call (L497-L510). [OBSERVED]
- **Tests.**
  - `exec_full_buffer_capture_keeps_io_drain_timeout_when_descendant_holds_pipe_open` (`codex-rs/core/src/exec_tests.rs:L297-L331`) detects a hang. It does not check that the early `hello` output is kept. [TEST]
  - `full_buffer_expiration_cleans_up_after_leader_exit` covers 9 cases: cancel, timeout or drain-timeout, on stdout or stderr (L341-L352). [TEST]
  - `process_exec_tool_call_cancellation_allows_sigterm_cleanup` (L1386-L1494) detects a missing SIGTERM-before-SIGKILL and a TERM-ignoring descendant that survives. [TEST]
- **Limits.** A 50 ms grace is short for real cleanup. Each call registers a process-wide `ctrl_c` listener, which is odd inside a server. [INFERENCE]
- **General or local.** The escalation ladder is general. Treating SIGINT to the agent as "kill the child" is desktop behaviour. [INFERENCE]
- **Audit harness.** Keep partial output on every failure path. Record "killed by signal N" (including OOM kills) as evidence, not as an error without output. Make the grace configurable. [INFERENCE]
- **Recommendation.** ADAPT IDENTIFIED CODE. Keep the `select!`/escalation structure; fix the paths that discard output.

### F3. Unified exec: long-running interactive sessions

- **Problem.** Dev servers, REPLs and long builds run longer than one tool call. [INFERENCE]
- **Code and state ownership.**
  - Each session has one `UnifiedExecProcessManager` (`codex-rs/core/src/session/session.rs:L1682-L1684`). It owns `Mutex<ProcessStore>` (`codex-rs/core/src/unified_exec/mod.rs:L155-L183`). The store maps a random id in 1,000–99,999 (`process_manager.rs:L448-L474`) to a `ProcessEntry{Arc<UnifiedExecProcess>, last_used, permissions snapshot, …}` (`mod.rs:L191-L205`). [OBSERVED]
  - `exec_command_inner` stores a live process *before* the first yield, "so interrupting the turn cannot drop the last Arc" (`process_manager.rs:L594-L629`). It collects output until `start + clamp_yield_time(...)` (L631-L647; clamp 250–30,000 ms, Windows floor 10,000; `mod.rs:L218-L225`). It returns a `process_id` only if the process is still alive (L717-L767). [OBSERVED]
  - `write_stdin` holds a per-process `interaction_lock`: calls on one terminal never overlap, while different terminals poll in parallel (L885-L900). [OBSERVED]
  - An empty poll waits between 5,000 ms and `background_terminal_max_timeout` (default 300,000; `codex-rs/core/src/config/mod.rs:L1090-L1092`, `L3912-L3915`; `process_manager.rs:L1013-L1022`). A write is capped at 30,000 ms (L1016-L1021), and a successful write is followed by a 100 ms settle sleep (L991-L996). [OBSERVED]
  - A non-TTY session has no stdin (`stdin_open: tty`, L1420-L1421; `codex-rs/sandboxing/src/spawn.rs:L109-L140`). It accepts only `"\u{3}"`, which becomes SIGINT to the group (L983-L989; `codex-rs/utils/pty/src/pipe.rs:L50-L54`). The default is `tty=false` (`codex-rs/core/src/tools/handlers/unified_exec.rs:L70-L72`), although the tool description says "in a PTY". [OBSERVED]
  - The deadline is extended while an approval pause is active (L1687-L1711). [OBSERVED]
  - Store limit: `MAX_UNIFIED_EXEC_PROCESSES = 64` (`mod.rs:L82`). An insert first prunes an exited entry that is least recently used and outside the 8 most recently used, otherwise the least recently used live entry. Entries whose lock is held are skipped (L1723-L1794), and a pruned process is terminated (L1225-L1236). [OBSERVED]
  - Termination paths:
    - `terminate_all_processes` on shutdown (`codex-rs/core/src/session/handlers.rs:L307-L310`) or when the client sends `clean_background_terminals` (L61-L63);
    - `terminate_process` for one process (`process_manager.rs:L1843-L1875`);
    - `Drop` (`codex-rs/core/src/unified_exec/process.rs:L663-L667`).

    [OBSERVED]
  - No idle eviction was found (grep `idle|Idle` in `core/src/unified_exec`). [OBSERVED]
  - There is no wall-clock limit. `unified_exec_options` builds an `ExecExpiration::DefaultTimeout` (`codex-rs/core/src/tools/runtimes/unified_exec.rs:L123-L134`), but a grep for `\.expiration` in `core/src` finds only a test (L803). [INFERENCE]
  - Exit reporting: a pipe reports its exit code, or 128+signal (`codex-rs/utils/pty/src/process.rs:L35-L49`). A one-shot timeout forces 124 (`process.rs:L218-L221`). The model's "Wall time" is the time spent waiting in that call (`codex-rs/core/src/tools/handlers/shell_spec.rs:L206-L209`). The process runtime appears in the `ExecCommandEnd` event that the exit watcher emits (`codex-rs/core/src/unified_exec/async_watcher.rs:L158-L243`). [OBSERVED]
- **Tests.**
  - `unified_exec_timeouts` (`codex-rs/core/src/unified_exec/mod_tests.rs:L463-L512`) fails if late output is lost between polls. [TEST]
  - `unified_exec_pause_blocks_yield_timeout` (L515); `reusing_completed_process_returns_unknown_process` (L555-L596). [TEST]
  - The pruning unit tests (`process_manager_tests.rs:L532-L593`) and `pruning_does_not_evict_live_process_while_exited_process_is_finalizing` (L597). [TEST]
  - Integration tests `unified_exec_keeps_long_running_session_after_turn_end` (`codex-rs/core/tests/suite/unified_exec.rs:L2847`) and `unified_exec_interrupt_preserves_long_running_session` (L2948). [TEST]
  - `managed_unified_exec_disable_runs_commands_without_retained_authority` (L3325-L3387) fails if a timed-out one-shot survives long enough to write a marker file. [TEST]
- **General or local.** The poll/yield model is general. An unbounded lifetime in an in-memory store suits one user on a desktop. [INFERENCE]
- **Audit harness.** Needs wall-clock and idle limits, per-tenant quotas, a durable session state (or an explicit "abandoned" record after a restart), and an attributed log of every stdin write. [INFERENCE]
- **Recommendation.** ADAPT IDENTIFIED CODE. Keep yield/poll and the per-terminal lock; add limits and durable state.

### F4. Stream capture, caps and incremental delivery

- **`exec()` path.** [OBSERVED]
  - It reads 8 KiB chunks (`codex-rs/core/src/exec.rs:L74`, `L1204-L1241`).
  - It emits one `ExecCommandOutputDelta` per read, up to `MAX_EXEC_OUTPUT_DELTAS_PER_CALL = 10_000` (L85, L1213-L1233).
  - It keeps reading to EOF "to avoid back-pressure", but retains only a 1 MiB prefix per stream (L81, L855-L863).
  - When combining under contention, stdout is reserved one third and stderr two thirds, and unused space is rebalanced (L893-L898).
  - No truncation marker is written on this path.
- **Unified exec.** [OBSERVED]
  - The backends send 8 KiB chunks into an `mpsc(128)` per stream (`codex-rs/utils/pty/src/pipe.rs:L108-L123`, `L217-L219`).
  - These are merged into a `broadcast(256)` (`codex-rs/utils/pty/src/process.rs:L319-L352`). A PTY has only one stream (`codex-rs/utils/pty/src/pty.rs:L219-L221`).
  - Each chunk is appended to `pending` (drained by polls) and to `transcript` (for the end event). Both are `HeadTailBuffer<1 MiB>` (`codex-rs/core/src/unified_exec/process.rs:L61-L74`, `L619-L654`).
  - The buffer keeps a 512 KiB head and a 512 KiB tail, and counts omitted bytes (`codex-rs/core/src/unified_exec/head_tail_buffer.rs:L5-L91`). It renders them as `... N bytes omitted ...` (L106-L124).
  - Deltas are re-chunked to at most 8,192 bytes on UTF-8 boundaries (malformed bytes pass through raw), with the same 10,000 quota, plus a 100 ms trailing grace (`codex-rs/core/src/unified_exec/async_watcher.rs:L34-L42`, `L96-L129`, `L245-L325`, `L439-L457`).
- **Silent loss.**
  - All three broadcast consumers `continue` on `Lagged` (`codex-rs/core/src/unified_exec/process.rs:L645`; `async_watcher.rs:L117-L119`; `codex-rs/utils/pty/src/process.rs:L427`). [OBSERVED]
  - A dropped chunk is therefore neither kept nor counted in `omitted_bytes`. [INFERENCE]
  - The session event channel is unbounded (`codex-rs/core/src/session/mod.rs:L586`), so a slow client can queue about 10,000 × 8 KiB per call. [INFERENCE]
- **Tests.**
  - `read_output_limits_retained_bytes_for_shell_capture` (`codex-rs/core/src/exec_tests.rs:L102-L118`), plus the aggregate-split tests (L121-L218). [TEST]
  - `output_collection_stays_bounded_across_repeated_drains` and `…preserves_omissions_from_drained_buffer` (`codex-rs/core/src/unified_exec/process_manager_tests.rs:L342-L423`). [TEST]
  - Head/tail edge cases (`head_tail_buffer_tests.rs:L6-L91`). [TEST]
  - `streaming_output_bounds_invalid_bytes` and `utf8_boundary_batches_malformed_output` (`async_watcher_tests.rs:L391-L433`). [TEST]
  - `unified_exec_streams_after_lagged_output` (`codex-rs/core/tests/suite/unified_exec.rs:L3131-L3239`) checks that output resumes after lag. It does not check that no data was lost. [TEST]
- **General or local.** Head/tail retention with explicit omission counts is general. [INFERENCE]
- **Audit harness.** Would retain the full byte stream (spooled to storage, with a hash) and bound only the views. [INFERENCE]
- **Recommendation.** ADOPT PATTERN (head/tail + omission counter), and make loss accounting complete, including lagged bytes.

### F5. How output is formatted and truncated for the model

- **Code.** [OBSERVED]
  - `ExecCommandToolOutput::response_text` (`codex-rs/core/src/tools/context.rs:L550-L575`) writes a header first: `Chunk ID`, `Wall time`, `Process exited with code N` or `Process running with session ID N`, `Original token count`, then `Output:` (L524-L548).
  - The output budget is the smaller of `max_output_tokens` (default 10,000; `codex-rs/core/src/unified_exec/mod.rs:L79`, `L227-L229`) and the model policy (`context.rs:L481-L489`). The model can therefore only lower the budget.
  - The result is shrunk again to fit the ×1.2 serialization allowance (`codex-rs/utils/output-truncation/src/lib.rs:L16-L18`).
  - Truncation keeps the prefix and the suffix around `…N tokens truncated…`, preceded by `Warning: truncated output (original token count: N)` and `Total output lines` (`lib.rs:L20-L38`; `codex-rs/utils/string/src/truncate.rs:L38-L153`).
  - Tokens are estimated as bytes/4 (`truncate.rs:L4`, `L71-L84`).
  - The default policy is `tokens: 10000` in `codex-rs/models-manager/models.json:L15-L18`. The fallback for unknown models is `bytes(10_000)` (`codex-rs/models-manager/src/model_info.rs:L127`). `tool_output_token_limit` overrides both (L32-L44).
  - Live history applies the budget again "only to live history, preserving full rollout payloads" (`codex-rs/core/src/context_manager/history.rs:L496`, `L546-L555`).
  - Code mode gets the raw output (up to 1 MiB) when no `max_output_tokens` is set (`context.rs:L469-L472`).
  - The `exec()` path formats `Exit code / Wall time / Output` and prefixes `command timed out after N milliseconds` (`codex-rs/core/src/tools/mod.rs:L101-L149`).
- **Tests.**
  - `unified_exec_formats_large_output_summary` (`codex-rs/core/tests/suite/unified_exec.rs:L3453-L3545`) detects a missing HEAD or TAIL, a missing omission marker, or a wrong original token count. [TEST]
  - `exec_command_clamps_model_requested_max_output_tokens_to_policy` (L1967), and the same check for `write_stdin` (L2026). [TEST]
  - Truncation unit tests in `codex-rs/utils/output-truncation/src/truncate_tests.rs:L14-L439`. [TEST]
- **General or local.** This is general. [INFERENCE]
- **Audit harness.** The evidence copy must stay complete or be hash-referenced, never the truncated view. [INFERENCE]
- **Recommendation.** ADOPT PATTERN.

### F6. Encoding, serialisation and what is kept durably

- **Decoding differs by path.** [OBSERVED]
  - `exec()` uses `bytes_to_string_smart`: UTF-8 first, then a chardetng/encoding_rs guess, then lossy (`codex-rs/protocol/src/exec_output.rs:L1-L7`, `L63-L126`; the wrapper at L30-L37 is misleadingly named `from_utf8_lossy`).
  - Unified exec uses plain `String::from_utf8_lossy` (`codex-rs/core/src/unified_exec/process_manager.rs:L659-L665`).
- **Consequence.** Binary output is transcoded into text that cannot be reversed. [INFERENCE]
- **Wire formats.** [OBSERVED]
  - Delta chunks are raw bytes serialised as base64 (`codex-rs/protocol/src/protocol.rs:L3664-L3676`). The app-server v2 notification carries `delta: String` (`codex-rs/app-server-protocol/src/protocol/v2/item.rs:L1506-L1511`).
  - `ResponseItem` is tagged with `type` (`codex-rs/protocol/src/models.rs:L1010-L1012`).
  - `FunctionCallOutputPayload` serialises only `body`. `success` is dropped on write and becomes `None` on read (L2179-L2190, L2253-L2276).
- **Size guards.** [OBSERVED]
  - JSON-RPC messages are capped at 64 MiB on exec-server transports (`codex-rs/exec-server/src/connection.rs:L39-L41`).
  - `to_json_string_bounded` exists (`codex-rs/utils/string/src/json.rs:L57-L80`), but only MCP attribution metadata uses it (`codex-rs/core/src/responses_metadata.rs:L362`).
- **Durability.**
  - The rollout policy classes `ExecCommandBegin/End`, `ExecCommandOutputDelta`, `TerminalInteraction` and `ExecApprovalRequest` as "Transient, non-durable" (`codex-rs/rollout/src/policy.rs:L141-L180`). [OBSERVED]
  - Paginated history keeps `ItemCompleted`, and its CommandExecution item carries stdout, stderr, aggregated and formatted output (`codex-rs/core/src/tools/events.rs:L581-L611`). Legacy history keeps only the model-facing function output (`policy.rs:L96-L112`). [OBSERVED]
- **Audit harness.** Store raw bytes, a hash and the decoding used; persist execution records as durable facts. [INFERENCE]
- **Recommendation.** IMPLEMENT INDEPENDENTLY.

### F7. Remote exec-server: sequence-numbered output with replay

- **Problem.** Follow output across a network hop without losing data when a subscriber lags or reconnects. [INFERENCE]
- **Code.** [OBSERVED]
  - Each output chunk gets a `seq` number. The executor keeps at most 1 MiB or 50,000 chunks per process and evicts from the front (`codex-rs/exec-server/src/local_process.rs:L85-L96`, `L985-L1020`).
  - An exited process is kept for 30 s (L1202-L1213).
  - The protocol methods are `process/start|read|write|signal|terminate`, and the notifications are `process/output|exited|closed` (`codex-rs/exec-server-protocol/src/protocol.rs:L24-L31`).
  - `ExecProcessEventLog` gives a new subscriber a bounded replay, then live updates (`codex-rs/exec-server/src/process.rs:L42-L120`).
  - The core consumer detects a gap (`seq > last_seq+1`), a lag, or a missing sandbox flag, and resyncs with `read(Some(last_seq))`. If the stream closes, it marks the process as failed (`codex-rs/core/src/unified_exec/process.rs:L452-L566`).
  - Client limits are 256 events and 1 MiB (`codex-rs/exec-server/src/client.rs:L167-L170`).
- **Tests.**
  - `remote_write_unknown_process_marks_process_exited` (`codex-rs/core/src/unified_exec/process_tests.rs:L113`) and `remote_terminate_confirmed_updates_state_on_success_only` (L168). [TEST]
  - `unified_exec_uses_remote_exec_server_when_configured` (`mod_tests.rs:L811`). [TEST]
- **Limits.**
  - Output evicted before a reader catches up is gone. [INFERENCE]
  - Hosted remote environments use the noise-registry and ChatGPT-account variables (`codex-rs/exec-server/src/environment.rs:L56-L62`), so they require a hosted service. [INFERENCE]
- **General or local.** This design is general and server-ready. [INFERENCE]
- **Audit harness.** Persist chunks append-only, keyed by (process, seq), for replayable evidence. [INFERENCE]
- **Recommendation.** ADOPT PATTERN.

### F8. apply_patch: format, verification and (lack of) atomicity

- **Format.** [OBSERVED]
  - The envelope is `*** Begin Patch` / `*** Add|Delete|Update File:` / `*** Move to:` / `@@` context / `*** End of File` / `*** End Patch`, with an optional `*** Environment ID:` (`codex-rs/apply-patch/src/parser.rs:L4-L25`).
  - Lenient parsing is always on (`PARSE_IN_STRICT_MODE = false`, L47-L53).
  - Context matching loosens step by step: exact, then trailing whitespace ignored, then both sides trimmed, then Unicode punctuation normalised (`codex-rs/apply-patch/src/seek_sequence.rs:L1-L80`).
- **Verification.**
  - `try_verify_apply_patch_args` reads every target, computes the new contents and unified diffs, and rejects two operations on one path (`codex-rs/apply-patch/src/invocation.rs:L214-L295`, `L235-L241`). This feeds the approval request. [OBSERVED]
  - Execution then re-parses `req.action.patch` and applies it to the *current* filesystem (`codex-rs/core/src/tools/runtimes/apply_patch.rs:L179-L198`). [OBSERVED]
  - The approved diff and the written bytes can therefore differ (a TOCTOU window). [INFERENCE]
- **Atomicity.** [OBSERVED]
  - Hunks are applied one after another. On failure, `ApplyPatchFailure{error, delta}` lists the changes already committed, with `exact=false` after a failed write or an unreadable earlier state (`codex-rs/apply-patch/src/lib.rs:L245-L336`, `L470-L726`, `try_write!` L489-L502).
  - There is no rollback. A move writes the destination, then removes the source (L619-L692).
  - Writes use `tokio::fs::write`, which truncates then writes, with no temp file and rename (`codex-rs/exec-server/src/local_file_system.rs:L654-L668`). Reads are capped at 512 MiB (L45, L629-L639).
  - Deltas accumulate across sandbox retries (`runtimes/apply_patch.rs:L203-L207`).
- **Tests.**
  - `test_failed_move_returns_committed_destination_delta` (`codex-rs/apply-patch/src/lib.rs:L1107-L1160`) asserts that the partial state (destination written, source intact) is reported exactly. [TEST]
  - `test_apply_patch_fails_on_write_error` (L1360-L1388) asserts `exact=false`. [TEST]
  - `test_unreadable_destinations_return_inexact_delta` (L1391). [TEST]
- **General or local.** Honest partial-commit reporting is general. Leniency tuned to one model is specific. [INFERENCE]
- **Audit harness.** Writes need staging, fsync and rename (or a transaction), and the approval must be hash-bound to the exact bytes written. [INFERENCE]
- **Recommendation.** ADAPT IDENTIFIED CODE. Reuse the parser and the delta reporting; replace the application step.

### F9. Environment inheritance and shell snapshots

- **Environment defaults.** [OBSERVED]
  - The default `ShellEnvironmentPolicy` is inherit All with `ignore_default_excludes: true` (`codex-rs/protocol/src/config_types.rs:L261-L272`; `codex-rs/config/src/shell_environment_policy.rs:L133-L136`).
  - So the `*KEY*/*SECRET*/*TOKEN*` filter is off unless configured (`codex-rs/protocol/src/shell_environment.rs:L123-L131`).
  - Only the five `NON_INHERITABLE_ENV_VARS` are always removed (L14-L20, L155-L157).
- **Unified exec additions.** It forces `NO_COLOR=1, TERM=dumb, LANG/LC_*=C.UTF-8, PAGER/GIT_PAGER/GH_PAGER=cat, CODEX_CI=1` and injects thread, session and version ids (`codex-rs/core/src/unified_exec/process_manager.rs:L93-L104`, `L1443-L1456`). [OBSERVED]
- **Shell snapshots.** A snapshot runs the login shell once with a 10 s timeout and writes `$CODEX_HOME/shell_snapshots/<session>.sh`. The file is deleted on drop, and files older than 3 days are swept (`codex-rs/core/src/shell_snapshot.rs:L105-L107`, `L528-L573`, `L1024-L1118`, `L1123-L1184`). [OBSERVED]
- **Tests.** `non_inheritable_environment_is_removed_after_policy_overrides` (`codex-rs/protocol/src/shell_environment_tests.rs:L13`) and `exec_command_does_not_expose_configured_noise_auth_token` (`codex-rs/core/tests/suite/unified_exec.rs:L400`) fail if a scrubbed launch variable reaches a child, even when set by policy. [TEST]
- **General or local.** Replaying the user's shell profile is desktop-specific. [INFERENCE]
- **Audit harness.** Use a default-deny environment and broker secrets. [INFERENCE]
- **Recommendation.** DO NOT ADOPT the defaults. The `env_clear` + non-inheritable-list mechanism is fine.

### F10. Artifacts: attachment store, worktrees and temp files

- **Attachment store.**
  - `codex-attachment-store` is an interface: upload, resolve, and an optional download-URL time-to-live (`codex-rs/attachment-store/src/lib.rs:L28-L34`, `L58-L69`). [OBSERVED]
  - The only in-tree implementation keeps data inline (L160-L183). Its metadata digest is MD5 (L77-L79). Debug output redacts bytes and URLs (L47-L56, L96-L109). [OBSERVED]
  - Non-inline stores appear only in tests (`codex-rs/core/tests/suite/image_rollout.rs:L69`), so they require a hosted service. [INFERENCE]
- **Worktree manager.** [OBSERVED]
  - `codex-worktree` creates detached git worktrees under `<root>/<4-hex bucket>/<repo>`. It rolls back an incomplete creation and refuses to remove a worktree that holds ignored files (`codex-rs/worktree/src/lib.rs:L62-L166`, `L284-L329`, `L383-L398`).
  - git runs hardened: hooks point to /dev/null, fsmonitor is off, filters are disabled, `GIT_*` selectors are removed, LFS smudge is skipped and terminal prompts are off (`codex-rs/worktree/src/git.rs:L1-L11`, `L142-L182`). There is no timeout (`Command::output()`, L53).
  - The keep count is 15, and the CLI never auto-cleans (`codex-rs/worktree/src/settings.rs:L12-L36`).
  - Only the `exec` and `tui` crates use it (grep); core sub-agents do not.
- **Tests.** `attachment_debug_output_redacts_bytes` and `attachment_metadata_debug_output_redacts_file_url` (`codex-rs/attachment-store/src/lib_tests.rs:L7`, `L28`) fail if bytes or URLs leak into Debug output; `checkout_does_not_execute_configured_hooks_fsmonitor_or_filters` (`codex-rs/worktree/src/git_tests.rs:L81`) fails if repository-configured hooks or filters run. [TEST]
- **General or local.** The storage interface and the git hardening are general; the Desktop-compatible worktree layout is product-specific. [INFERENCE]
- **Audit harness.** Evidence needs content-addressed SHA-256 storage, immutability, retention and access logging; git calls need timeouts. [INFERENCE]
- **Recommendation.** ADOPT PATTERN for the git hardening. IMPLEMENT INDEPENDENTLY for evidence storage (SHA-256, immutability, retention).

### F11. Images and in-process compute

- **Images.** [OBSERVED]
  - `view_image` reads the whole file (512 MiB cap) and fully decodes it with `image::load_from_memory` just to validate it (`codex-rs/core/src/tools/handlers/view_image.rs:L162-L201`).
  - Resizing happens later. High detail is capped at 2048 px; original detail at 6000 px or 10,000 patches. Data URLs have a 1 GiB sanity cap, and there is a 64 MiB cache (`codex-rs/utils/image/src/lib.rs:L24-L32`, `L75-L95`, `L284-L303`).
  - The resize runs synchronously inside an async function (`codex-rs/core/src/image_preparation.rs:L378-L406`; no `spawn_blocking` in that file).
- **Consequence.** A large image can stall a runtime worker. [INFERENCE]
- **Other in-process compute.** [OBSERVED]
  - chardetng decoding (see F6).
  - tree-sitter parsing of model-supplied commands, with no input bound (`codex-rs/shell-command/src/bash.rs:L15`, `L101-L160`).
  - `codex-file-search`: an `ignore` walker plus the nucleo matcher. Defaults are 2 threads and 20 results. It follows symlinks and has no depth or entry cap; the cancel flag is checked every 1,024 entries (`codex-rs/file-search/src/lib.rs:L105-L133`, `L427-L495`). Only the TUI and app-server fuzzy search use it, not the model tools.
  - `codex-mermaid` is a bounded, I/O-free TUI renderer (at most 16 KiB of source, 16 nodes, 24 edges; `codex-rs/mermaid/src/lib.rs:L1-L24`).
  - `codex-ansi-escape` converts ANSI escapes for the TUI and calls `panic!` on a parser error (`codex-rs/ansi-escape/src/lib.rs:L57-L73`). The model path does not strip ANSI; it suppresses colour through the environment instead.
- **Tests.** `handle_rejects_invalid_image_before_returning_output_to_code_mode` (`codex-rs/core/src/tools/handlers/view_image.rs:L484`) fails if a non-image passes; `detail_policies_apply_the_expected_budgets` and `upload_failure_keeps_resized_image_inline` (`codex-rs/core/src/image_preparation_tests.rs:L148`, `L266`); `dropping_session_does_not_cancel_siblings_with_shared_cancel_flag` (`codex-rs/file-search/src/lib.rs:L912`). [TEST]
- **General or local.** Image intake is general; fuzzy search, Mermaid and ANSI rendering serve the local UI. [INFERENCE]
- **Audit harness.** Keep an unmodified, hashed original of any screenshot used as evidence, separate from the resized model copy. [INFERENCE]
- **Recommendation.** IMPLEMENT INDEPENDENTLY. Cap the input and decode in a blocking pool or a worker process.

### F12. Untrusted-execution boundary (boundary only)

- **Sandbox boundary.** [OBSERVED]
  - `ToolRuntime::run(req, &SandboxAttempt, ctx)` receives an argv rewritten by `SandboxManager::transform` (`codex-rs/core/src/tools/sandboxing.rs:L364-L406`, `L475-L504`).
  - When policy allows, the orchestrator retries without the sandbox after a likely denial (`codex-rs/core/src/tools/orchestrator.rs:L328-L507`). Denial detection partly parses output text (`codex-rs/core/src/unified_exec/process.rs:L322-L356`).
  - Linux bwrap uses `--new-session --die-with-parent --unshare-user --unshare-ipc [--unshare-pid] [--unshare-net]` (`codex-rs/linux-sandbox/src/bwrap.rs:L281-L305`).
- **Terminal input review.** [OBSERVED]
  - Input to a running terminal is re-reviewed when the current policy differs from the launch snapshot. The process itself keeps its launch sandbox (`codex-rs/core/src/unified_exec/stdin_approval.rs:L1-L5`, `L132-L140`, `L180-L242`).
  - An approval payload over `MAX_STDIN_APPROVAL_BYTES = 8_000` is rejected (`process_manager.rs:L108`, `L927-L948`).
- **Parallelism.** Tools that support parallel calls share a read lock; all other tools take the write lock (`codex-rs/core/src/tools/parallel.rs:L205-L208`). [OBSERVED]
- **Tests.** `reduced_permissions_require_review` and `proxy_bypass_requires_review_even_when_permissions_match` (`codex-rs/core/src/unified_exec/stdin_approval_tests.rs:L38`, `L55`); `unreviewable_stdin_is_rejected_before_approval_or_execution` (`codex-rs/core/tests/suite/unified_exec_stdin_review_size.rs:L36`); `stdin_approval_preserves_the_reviewed_terminal` (`codex-rs/core/src/unified_exec/mod_tests.rs:L904`). [TEST]
- **General or local.** Reviewing terminal input against a launch-time permission snapshot is general; retrying without the sandbox after a heuristic denial suits an interactive local user. [INFERENCE]
- **Audit harness.** Revoking a permission does not reach a process that is already running, so a harness needs kill-on-revoke. [INFERENCE]
- **Recommendation.** ADOPT PATTERN for launch-snapshot permissions and input review; DO NOT ADOPT heuristic unsandboxed retry in a multi-tenant server.

## 3. Fault-injection tests that exist

| Fault | Test (file:line) | What it detects |
|---|---|---|
| Timeout with grandchildren | `kill_child_process_group_kills_grandchildren_on_timeout` `core/src/exec_tests.rs:L1272` | A surviving descendant |
| Cancel; TERM-ignoring child | `process_exec_tool_call_cancellation_allows_sigterm_cleanup` `exec_tests.rs:L1386` | A missing SIGTERM cleanup or a failed SIGKILL escalation |
| Pipe held by a descendant | `exec_full_buffer_capture_keeps_io_drain_timeout_when_descendant_holds_pipe_open` `exec_tests.rs:L297` | The agent hanging (not output loss) |
| Drain/cancel/timeout after the leader exits | `full_buffer_expiration_cleans_up_after_leader_exit` `exec_tests.rs:L341` | Leaked processes and wrong status |
| Huge output | `read_output_limits_retained_bytes_for_shell_capture` `exec_tests.rs:L102`; `unified_exec_formats_large_output_summary` `core/tests/suite/unified_exec.rs:L3453` | Retention over the cap; a missing HEAD/TAIL or marker |
| Output lag | `unified_exec_streams_after_lagged_output` `suite/unified_exec.rs:L3131` | Streaming stopping after lag |
| Non-UTF-8 output | `streaming_output_bounds_invalid_bytes` `core/src/unified_exec/async_watcher_tests.rs:L401`; `test_invalid_bytes_still_fall_back_to_lossy` `protocol/src/exec_output_tests.rs:L64` | Frame bounds and lossy fallback |
| Killed or exited child reuse | `reusing_completed_process_returns_unknown_process` `core/src/unified_exec/mod_tests.rs:L555` | A stale session id accepted |
| One-shot timeout or interrupt | `suite/unified_exec.rs:L3325`, `L3390` | A process surviving its timeout or an interrupt |
| PTY with a full output channel | `pty_terminate_allows_runtime_shutdown_with_full_output_channel` `utils/pty/src/tests.rs:L1036` | A shutdown deadlock under back-pressure |
| Partial patch | `test_failed_move_returns_committed_destination_delta` `apply-patch/src/lib.rs:L1107` | A wrong committed-delta report |

No test was found for a child killed by a signal (other than a timeout) that checks its output is kept, or for output loss under broadcast lag.

## 4. Hard numbers

| Constant | Value | Reference |
|---|---|---|
| Default exec timeout | 10,000 ms | `core/src/exec.rs:L63` |
| Cancel grace (SIGTERM→SIGKILL) | 50 ms | `exec.rs:L71` |
| Pipe drain timeout | 2,000 ms | `exec.rs:L94` |
| Read chunk | 8 KiB | `exec.rs:L74`; `utils/pty/src/pipe.rs:L112` |
| Retained output | 1 MiB | `utils/pty/src/lib.rs:L25`; `core/src/unified_exec/mod.rs:L80` |
| Deltas per call / max delta size | 10,000 / 8,192 B | `exec.rs:L85`; `async_watcher.rs:L42` |
| Yield: default / min / max / Windows floor | 10,000 / 250 / 30,000 / 10,000 ms | `handlers/unified_exec.rs:L62-L64`; `unified_exec/mod.rs:L73-L77` |
| Empty poll: min / default max | 5,000 / 300,000 ms | `unified_exec/mod.rs:L76-L78` |
| Max processes per session / protected most-recent | 64 / 8 | `unified_exec/mod.rs:L82`; `process_manager.rs:L1777` |
| Default output tokens / bytes-per-token | 10,000 / 4 | `unified_exec/mod.rs:L79`; `utils/string/src/truncate.rs:L4` |
| Early-exit grace / post-exit close wait / trailing grace | 150 / 50 / 100 ms | `unified_exec/process.rs:L39`; `process_manager.rs:L1579`; `async_watcher.rs:L34` |
| stdin approval payload cap | 8,000 B | `process_manager.rs:L108` |
| exec-server retention / exited-process keep | 1 MiB, 50k chunks / 30 s | `exec-server/src/local_process.rs:L85-L96` |
| JSON-RPC message cap | 64 MiB | `exec-server/src/connection.rs:L41` |
| File read cap / read chunk | 512 MiB / 1 MiB | `exec-server/src/local_file_system.rs:L45`; `file-system/src/lib.rs:L41` |
| Shell snapshot timeout / retention | 10 s / 3 days | `core/src/shell_snapshot.rs:L105-L106` |
| User `!cmd` timeout | 1 h | `core/src/tasks/user_shell.rs:L48` |
| Broadcast / mpsc capacities | 256 / 128 chunks | `utils/pty/src/process.rs:L324`; `pipe.rs:L217-L219` |

## 5. Feature flags and hosted-service dependencies

- **Feature defaults.**
  - Stable and on: `unified_exec`, `unified_exec_tty` (`codex-rs/features/src/lib.rs:L991-L1002`), `shell_tool` (L967-L972), `shell_snapshot` (L1015-L1020) and `write_stdin_approval` (L1219-L1224).
  - Under development and off: `shell_zsh_fork` (L1003-L1008), `apply_patch_preserve_line_endings` and `exec_permission_approvals` (L1207-L1218).
  - [OBSERVED]
- **One-shot mode.** It appears only through managed requirements. The test loads an enterprise cloud-config bundle (`codex-rs/core/tests/suite/unified_exec.rs:L3331-L3339`), which may require a hosted service. [OBSERVED]
- **Remote environments** use the noise registry and a ChatGPT account id (`codex-rs/exec-server/src/environment.rs:L56-L62`), so they require a hosted service. [INFERENCE]
- **Non-inline attachment stores** have no in-tree backend, so they require a hosted service. [INFERENCE]
- **App-server `command/exec`** can set `disable_output_cap` (unbounded `FullBuffer`) and `disable_timeout` (`codex-rs/app-server/src/request_processors/command_exec_processor.rs:L184-L201`). This must not be exposed to untrusted tenants. [OBSERVED]

## 6. Windows and macOS differences

On Windows the `exec()` path runs `exec_windows_sandbox` in `spawn_blocking`, passes timeout and cancellation separately, and buffers the full stdout/stderr before cutting it to 1 MiB (`codex-rs/core/src/exec.rs:L611-L780`) [OBSERVED]; the process-group helpers are no-ops (`codex-rs/utils/pty/src/process_group.rs:L43-L47`, `L249-L253`, `L285-L289`, `L301-L305`) and tree containment uses Job Objects with an accepted race in which a descendant can escape (`codex-rs/utils/pty/src/pipe.rs:L131-L132`, `L183-L207`) [OBSERVED]; it also uses `CREATE_NO_WINDOW` (`codex-rs/utils/process/src/lib.rs:L11-L22`), ConPTY and a 10 s yield floor [OBSERVED]. On macOS a denied group signal is retried per member via `proc_listpgrppids` (`process_group.rs:L138-L225`) and inherited fds are closed in `pre_exec` (`codex-rs/core/src/spawn.rs:L83-L87`, `L116-L118`) [OBSERVED]; with no parent-death signal, children can survive a Codex crash [INFERENCE]. For a Linux server only the Linux paths matter: PDEATHSIG, the `/proc/self/exe` spawn helper, bwrap namespaces with `--die-with-parent`, and the 24×80 default PTY size (`codex-rs/utils/pty/src/process.rs:L63-L67`) [INFERENCE].

## 7. Orchestration, in-process compute and untrusted execution

Orchestration is about seven tokio tasks per process (two readers, writer, waiter, output/combine, streaming, exit watcher) sharing `Arc<Mutex<OutputBuffers>>`, `watch<ProcessState>`, `Notify` and `CancellationToken` (`codex-rs/core/src/unified_exec/process.rs:L99-L163`) [OBSERVED]. In-process CPU work is light — image decode/resize, encoding detection, tree-sitter parsing, the `similar` patch diff and UI fuzzy search (F11) [OBSERVED]. Untrusted programs always run as children behind the sandbox transform (F12); only parsing and decoding of untrusted strings happens in-process [INFERENCE].

## Reuse candidates

| Candidate | Dependencies (Cargo.toml) | Licence | Lift? / changes |
|---|---|---|---|
| `core/src/unified_exec/head_tail_buffer.rs` (169 lines) | std only, plus 2 constants | Apache-2.0 (workspace, `codex-rs/Cargo.toml:L167`) | Copy verbatim; add a lag counter |
| `codex-utils-pty` (`codex-rs/utils/pty`) | anyhow, portable-pty 0.9.0, tokio, libc (unix); winapi, filedescriptor, shared_library (windows) | Apache-2.0 | Coherent; lift for spawn, killpg, the reaper and PTY. Linux requires `init_spawn_helper` at startup; add cgroups |
| `utils/string/src/truncate.rs` + `utils/output-truncation` | codex-protocol (heavy, types only), codex-utils-string | Apache-2.0 | Copy about 150 lines of `truncate.rs` instead of taking the crate |
| `codex-apply-patch` | anyhow, codex-exec-server (heavy), path-uri, absolute-path, similar, thiserror, tokio, tree-sitter(-bash) | Apache-2.0 | Lift `parser.rs`, `seek_sequence.rs` and `streaming_parser.rs`; rewrite application to be atomic and hash-bound |
| exec-server `ExecProcessEventLog` + seq resync | crate is heavy (axum, codex-api, …) | Apache-2.0 | Implement the pattern; do not take the crate |
| `worktree/src/git.rs` `base_git_command` | anyhow, codex-git-utils, codex-protocol, dunce, serde(_json), tempfile, uuid | Apache-2.0 | Copy about 40 lines of hardening; add timeouts |
| `codex-file-search` | anyhow, clap, crossbeam-channel, ignore, nucleo (git rev), serde(_json), tokio | Apache-2.0 | Standalone; only needed for UI search; add depth and entry caps |

The root `NOTICE` credits only Ratatui (MIT). No crate-level LICENSE file was found in the crates listed above.

## Coverage and limits

- **Read in full:**
  - `core/src/exec.rs`, `spawn.rs`, `exec_env.rs`, `shell.rs`;
  - `core/src/unified_exec/{mod,process,process_manager,oneshot,async_watcher,head_tail_buffer}.rs`;
  - `handlers/unified_exec*`, `shell_spec.rs`;
  - `utils/pty/{lib,process_group,pipe,child_command,child_reaper,process}.rs`.
- **Read in part:**
  - `utils/pty/src/pty.rs` (L60-L330), `core/src/shell_snapshot.rs`;
  - `apply-patch` (`lib`, `parser`, `invocation`, `seek_sequence`), `runtimes/apply_patch.rs`, `stdin_approval.rs`;
  - exec-server `local_process.rs`, `process.rs`, `connection.rs`, `client.rs`;
  - `file-search`, `worktree`, `attachment-store`, `utils/image`, `view_image.rs`;
  - rollout `policy.rs`, `protocol/models.rs` serde, `tools/context.rs`.
- **Not read:** `posix_child.rs` native spawn, `spawn_helper_main.rs`, the Windows sandbox crates, seatbelt/landlock, `zsh_fork/unix_escalation.rs`, snapshot wrapping in `runtimes/mod.rs`, `streaming_parser.rs`, `turn_diff_tracker.rs`, app-server `command_exec.rs` streaming, code mode, the rollout writer, exec-server `remote_process.rs` and its server handlers, and guardian review.
- **Not verified:**
  - What an app-server idle-thread unload (after `thread_unload_delay`, default 60 s; `codex-rs/core/src/config/mod.rs:L3916-L3917`) does to background processes. [INFERENCE: it likely goes through session shutdown]
  - Linux PDEATHSIG thread semantics.
- **Grep patterns behind the "not found" claims:**
  - `setrlimit|RLIMIT_|prlimit|cgroup`
  - `\.expiration` (in `core/src`)
  - `idle|Idle` (in `core/src/unified_exec`)
  - `max_depth|max_filesize|same_file_system` (in `file-search`)
  - `spawn_blocking` (in `image_preparation.rs`)
  - `strip_ansi|vte::` (in `core`, `sandboxing`, `utils/pty`)
  - `rename|persist|tempfile|atomic` (in exec-server file-system modules)
