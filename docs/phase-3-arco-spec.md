# Phase 3 — Arco Mode (spec v0)

**Status**: locked v0.2 — design decisions resolved, D2 risk verified and patched, ready to build
**Date**: 2026-04-21
**Relates to**: `docs/phase-2-podium-spec.md`, `docs/factory-protocol.md`, `packages/contracts/src/factory.ts`, `apps/server/src/codexAppServerManager.ts`.

**Revision history**:

- v0.1 (2026-04-21) — initial lock with six custom Arco RPCs and a restricted tool manifest.
- v0.2 (2026-04-21) — D2 verification showed Codex app-server does not support per-session tool allowlists. Spec reworked to enforce read-only behavior through the Codex sandbox + approval policy instead of a custom tool manifest. Tasks collapsed from seven to six.

---

## Purpose

Stand pairs one developer with one project. Podium shows the operator every project at once. Arco is the third leg of the stool: the **personal always-on agent** that reads across all tracked projects and helps the operator act on what's there without having to click into each one.

Where Podium answers "what's in my factory right now?", Arco answers "what should I do with it?" and "what happened while I was away?". It's the digest / brief / copilot surface — a persistent conversation bound to the operator, not to any single project.

Four user queries Arco v0 is validated against (driven directly by operator-stated examples):

1. **Project state** — "where are we with this project?" (status + phase + recent activity + pending queue).
2. **Gap triage** — "what gap do we need to solve?" (sorted C4 gap list, highest severity first).
3. **Code review** — "review this diff" (inline review of a bounded git patch).
4. **GitHub push coaching** — "help me push this project to GitHub" (state check + copy-pasteable shell commands; Arco never executes).

v0 is scoped to a **chat surface in a read-only Codex sandbox over the Podium root**. Arco uses Codex built-in tools (shell, read) to inspect `.factory/` and git state. Writes are blocked at the sandbox layer, not at the tool-manifest layer.

## Resolved design decisions

### D1. Single durable Arco thread per install (H1)

One Arco thread per Attacca install, persisted as a normal Codex session marked `scope: "arco"` so it's hidden from per-project thread lists. No per-conversation branching in v0 — a "new conversation" UI action clears local message history but keeps the same Codex session so cross-turn context continuity is preserved.

**Why**: Arco is a personal assistant, not a topic inbox. Multi-thread pickers/archives add UI surface with no clear v0 benefit. Single thread is simpler to build, simpler to reason about, and easy to split later if it becomes limiting.

### D2. Reuse Codex app-server pipeline (H2) — verified

Arco is a Codex app-server provider session like Stand. Differences are parameterization only:

- `cwd` = Podium root (via `startSession({ cwd })` — already supported in `codexAppServerManager.ts`).
- `runtimeMode` = new `"read-only"` mode that maps to `{ approvalPolicy: "never", sandbox: "read-only" }` in `mapCodexRuntimeMode`. This is the one Codex-side extension required by Arco.
- Developer instructions = Arco-specific system prompt injected via the existing `collaborationMode.settings.developer_instructions` path, loaded from `~/.attacca/arco-system.md`.

**Why the read-only runtimeMode is new**: the existing three `runtimeMode` values map to:

| runtimeMode         | approvalPolicy | sandbox              |
| ------------------- | -------------- | -------------------- |
| `approval-required` | `untrusted`    | `read-only`          |
| `auto-accept-edits` | `on-request`   | `workspace-write`    |
| `full-access`       | `never`        | `danger-full-access` |

Arco needs `never` + `read-only` — "don't spam the operator with approval prompts on read-only shell commands, but also don't allow any writes". No existing mode covers that pairing, so v0 adds a fourth value (`read-only`) to the `RuntimeMode` contract.

**Why no custom tool manifest**: Codex app-server does not expose a per-session tool allowlist. The built-in tools (shell, apply_patch, update_plan, request_user_input, file read) ship with every session. Rather than fight the platform, Arco enforces read-only through the sandbox + approval policy and uses the built-in tools to inspect `.factory/` + git state. This was the key change between spec v0.1 and v0.2.

### D3. Read-only access via sandbox, no custom RPCs (H3 revised)

Arco's tool surface is whatever Codex app-server exposes by default, constrained by the `read-only` runtimeMode. In practice this means:

- **Shell (read-only sandbox)** — `git log`, `git diff`, `git status`, `cat`, `ls`, etc. Any write attempt (`git push`, `apply_patch`, file edits) is blocked by the Codex sandbox before it reaches the filesystem.
- **File read** — Codex's built-in read tool can load `.factory/config.yaml`, `.factory/status.json`, `.factory/spec.md`, etc. for display in the thread.
- **`request_user_input`** — available, but suppressed by the Arco system prompt unless it's genuinely needed.

The Arco system prompt (D6) tells the agent:

- Where `.factory/` lives relative to each project under the Podium cwd.
- Which files to read for each common query type (status + spec + queue for "where are we"; `status.json#gap_count` and gap arrays in `ScannedProject` for "what gap"; `git diff` for "code review"; `git log` + config.yaml for "push to GitHub").
- Explicit reminders that Arco cannot write, execute pushes, or dispatch work — it outputs commands for the operator to run.

**Why no custom RPCs in v0**: three reasons.

1. Codex app-server has no per-session tool allowlist, so custom RPCs wouldn't _replace_ the built-ins — they'd only add on top. The read-only sandbox already enforces D4 regardless of which tools exist.
2. Shell + file read cover all four validated queries. A typed `arco.listProjects` RPC would be a shortcut, not a capability unlock.
3. Ship time. Deferring custom RPCs to v1 drops three tasks from the build and keeps the first-cut Arco small enough to land in one sitting.

**If built-in tools prove insufficient in practice** (e.g., output formatting is too noisy, shell cost is too high, or specific structured data like `ScannedProject[]` is awkward to reconstruct from shell), v1 adds typed Arco RPCs then. Start small, grow on demand.

### D4. Zero writes in v0 (H4) — sandbox-enforced

Arco cannot write to disk, cannot dispatch work packages, cannot invoke Forge skills, cannot execute shell commands that mutate state, and cannot push to git remotes. This is enforced at the **Codex sandbox layer** (`sandbox: "read-only"`), not at a tool-manifest layer.

**Why sandbox-enforced is stronger than manifest-enforced**:

- A sandbox-enforced read-only posture catches write attempts no matter which tool tries them (shell, apply_patch, a skill, a future MCP server the agent somehow registers).
- A tool-manifest approach would require re-deriving the allowlist every time Codex adds a new built-in tool. Sandbox is orthogonal to tool count.
- The operator gets a deterministic guarantee: "nothing in Arco's thread will ever mutate my repos." That's easier to reason about than "nothing on this allowlist writes" + trusting the allowlist stays complete.

**Friction acknowledged**: query #4 ("help me push to GitHub") resolves to Arco **generating** the commands and the operator pasting them into a terminal. The sandbox would block an actual push anyway, so the design alignment is natural rather than a workaround.

### D5. Manual trigger only (H5)

The Arco tab in `ModeSwitcher` becomes live (no more "Coming in Phase 3" tooltip) and routes to `/arco`. No background polling, no scheduled digests, no OS notifications in v0. "Always-on" means always _available_, not always _running_.

**Why**: scheduled digests need a background runner + delivery channel that warrants its own spec. Manual trigger is good enough to prove the value loop.

### D6. User-editable system prompt (H6)

The system prompt lives at `~/.attacca/arco-system.md`. Attacca ships a canonical default at `docs/arco-system-prompt.md` and copies it to the user's home dir on first Arco load. The user is free to edit the file; a "Restart Arco" button in settings ends the current session and starts a new one with the updated prompt.

**Why the system prompt matters more in v0.2 than v0.1**: with custom RPCs gone, the system prompt is now the only mechanism that tells the agent _how to use Codex built-ins effectively for cross-project queries_. Getting this document right is the single highest-leverage piece of work in Phase 3.

### D7. Identity inherited from `attacca.user` (H7)

Arco reuses the `attacca.user` client-settings identity established in Phase 2. No separate "Arco identity" field. Single-operator installs treat Arco as their assistant; multi-seat semantics are deferred.

**Why**: speculative multi-user complexity cost now, zero gain for single-operator v0.

## v0 scope

Six implementation tasks in build order:

1. **Contracts: extend `RuntimeMode` with `"read-only"`** — add the new value to the `RuntimeMode` schema in `packages/contracts/src/`. Update `mapCodexRuntimeMode` in `apps/server/src/codexAppServerManager.ts` to map it to `{ approvalPolicy: "never", sandbox: "read-only" }`. Update any exhaustive switches on `RuntimeMode` in the web client.

2. **Server: Arco session bootstrap** — new `apps/server/src/arco/session.ts` that starts a Codex provider session with:
   - `cwd` = `resolvePodiumRoot().rootDir`.
   - `runtimeMode` = `"read-only"`.
   - Developer instructions loaded from `~/.attacca/arco-system.md` (created from `docs/arco-system-prompt.md` on first launch).
   - No custom tools — relies on Codex built-ins + sandbox enforcement.
     Persist the session ID in client settings as `arcoSessionId` so reconnects resume the same session.

3. **Client: `/arco` route** — new `apps/web/src/routes/_chat.arco.tsx`. Reuses the existing chat composer, event renderer, and streaming plumbing from Stand. Removes the project header, queue panel, and Forge skill menu. Adds a "Scope: Arco" badge in the header. Composer placeholder reads "Ask Arco about your factory...".

4. **Client: Arco store** — new `apps/web/src/stores/arco.ts` holding session id, message history, streaming state, and an optional `refresh()` action. Selectors: `selectArcoThreadMessages`, `selectIsArcoStreaming`.

5. **Client: `ModeSwitcher` Arco enablement** — in `apps/web/src/components/ModeSwitcher.tsx` remove the `disabled` state and "Coming in Phase 3" tooltip on the Arco tab. Add `arco` handling to `resolveCurrentMode`. Wire the click to `navigate({ to: "/arco" })`.

6. **Defaults + system prompt + settings** — ship `docs/arco-system-prompt.md` as the canonical default. Add `arcoSessionId: Schema.NullOr(Schema.String)` and `arcoSystemPromptPath: Schema.NullOr(Schema.String)` to `ClientSettingsSchema`. Settings UI: "Arco" section with a "Restart Arco session" button (clears `arcoSessionId`), a read-only path display, and a "Restore default prompt" button (overwrites `~/.attacca/arco-system.md` from the canonical default).

## v0 non-behaviors

Explicitly **not** building:

- **Writing to disk** — sandbox-blocked (D4).
- **Shell execution of mutating commands** — sandbox-blocked (`git push`, file edits, etc.).
- **Scheduled digests / background polling / OS notifications** — manual trigger only (D5).
- **Multi-thread Arco** — single durable thread (D1).
- **Custom typed Arco RPCs** — `arco.listProjects`, `arco.gitDiff`, etc. deferred to v1 (D3).
- **Source-file reads via custom grep tools** — if the agent needs to grep a repo, it shells out to `grep`/`rg` in the read-only sandbox. No dedicated read-source tool.
- **Forge skill invocation from Arco** — same blocker as C3.6.
- **Arco writes session logs** — no `progress/arco-*.json`. Deferred to v1.
- **Proactive nudges** — Arco responds, doesn't initiate.
- **Multi-user / multi-seat semantics** — single `attacca.user` identity (D7).
- **Codex MCP integration** — Path C from the D2 verification notes. Not needed in v0.

## Integration boundaries

- **Codex app-server manager** (`apps/server/src/codexAppServerManager.ts`): extended with the new `"read-only"` runtimeMode mapping. `startSession` already accepts `cwd` — no further changes required.
- **Runtime mode contract** (`packages/contracts/src/...`): `RuntimeMode` schema gains `"read-only"`. Every exhaustive consumer updated (including UI badges and approval prompts).
- **Path validation**: not required for Arco because the Codex sandbox is the gatekeeper. If future work adds typed Arco RPCs (v1), those RPCs do go through `assertPathInsideAllowedRoot`.
- **Scanner**: unchanged. Arco inspects `.factory/` via shell + file read, not via the scanner RPC.
- **Git core**: unchanged. Arco runs `git` directly via the Codex sandbox, inheriting Codex's existing subprocess handling.
- **Orchestration manager** (`apps/server/src/providerManager.ts`): Arco's provider session registers like Stand's, scoped to the Arco thread id. Streaming reuses `orchestration.domainEvent` with events tagged `scope: "arco"`.
- **WebSocket router** (`apps/server/src/ws.ts`): no new `arco.*` aggregate in v0 (no custom RPCs). Reuses the existing provider-session plumbing.
- **Router** (`apps/web/src/routes/_chat.arco.tsx`): TanStack Router file-based. Must not conflict with `_chat.podium.tsx` or `_chat.$environmentId.$threadId.tsx`.
- **Settings** (`packages/contracts/src/settings.ts`): `arcoSessionId`, `arcoSystemPromptPath` added to `ClientSettingsSchema` with nullable defaults.

## Behavioral scenarios

### v0 Scenario 1 — First Arco open (Arco tab goes live)

**Given** a user on an install that just shipped Arco
**When** they click the Arco tab in `ModeSwitcher`
**Then**:

1. App navigates to `/arco`.
2. Server creates `~/.attacca/arco-system.md` from the default template if missing.
3. Server starts a Codex session with `cwd = Podium root` and `runtimeMode = "read-only"`.
4. Composer is empty and focused, placeholder "Ask Arco about your factory...".
5. No system message is shown in chat — the developer_instructions are invisible.

### v0 Scenario 2 — "Where are we with this project?"

**Given** the operator has 4 tracked projects; asks "where are we with acme-api?"
**When** Arco processes the query
**Then**:

1. Agent uses Codex file read to load `acme-api/.factory/status.json`, `config.yaml`, `spec.md`, `queue.json`.
2. Agent shells `git log --oneline --since="7 days ago"` in `acme-api/`.
3. Agent lists `.factory/progress/` with `ls` or equivalent to find recent session logs.
4. Response summarizes phase, trust tier, last session, pending queue items, and recent commits.

### v0 Scenario 3 — "What gap do we need to solve?"

**Given** the operator asks "what's the top gap I should fix right now?"
**When** Arco processes the query
**Then**:

1. Agent iterates tracked projects (listed under the Podium cwd) and reads each `.factory/status.json` + any gap arrays surfaced there.
2. Agent ranks gaps by severity (the Arco system prompt explains the severity scale and gap categories from the C4 spec).
3. Response names the top gap, cites the project + category, and reminds the operator to dispatch from Podium (D4 — Arco cannot dispatch itself).

### v0 Scenario 4 — "Run a code review"

**Given** the operator says "review the diff on feature/gap-dispatch vs main for this project"
**When** Arco processes the query
**Then**:

1. Agent shells `git diff main..feature/gap-dispatch` in the project cwd.
2. If output is large, the agent runs `--stat` first then targeted per-file `diff` calls.
3. Agent reviews patch content inline and outputs findings.
4. Agent never writes inline comments or modifies files. Sandbox would block any `apply_patch` attempt anyway.

### v0 Scenario 5 — "Help me push this project to GitHub"

**Given** the operator asks "help me push widget-service to GitHub"
**When** Arco processes the query
**Then**:

1. Agent reads `widget-service/.factory/config.yaml` for the `repo` field.
2. Agent shells `git log --oneline origin/main..HEAD` (or equivalent) to check for unpushed commits and `git status --porcelain` for working tree state.
3. Response outputs precondition summary ("3 commits ahead, clean working tree, no remote configured") plus copy-pasteable shell commands:

   ```
   gh repo create attacca-ai/widget-service --private
   git remote add origin git@github.com:attacca-ai/widget-service.git
   git push -u origin main
   ```

4. Agent never executes these commands. If it attempted `git push`, the sandbox would reject the write.

### v0 Scenario 6 — Write attempt blocked by sandbox

**Given** a bug in the prompt causes Arco to call `apply_patch` against `.factory/queue.json`
**When** the agent issues the tool call
**Then**:

1. Codex sandbox rejects the write because `runtimeMode = "read-only"` maps to `sandbox: "read-only"`.
2. The rejection surfaces as a tool-call error.
3. Agent explains the failure in chat and suggests the operator use Podium's dispatch flow.

### v0 Scenario 7 — Approval policy

**Given** the operator asks Arco to run `git log` in a project
**When** the agent issues the shell tool call
**Then**:

1. `approvalPolicy = "never"` lets the call proceed without prompting the operator.
2. The command runs in the read-only sandbox and returns output.
3. The operator is not interrupted with approval modals for routine read-only shell calls.

### v0 Scenario 8 — Session resume after reconnect

**Given** the operator is chatting with Arco, the WebSocket drops, and reconnects
**When** the client reconnects
**Then**:

1. The Arco store reads `arcoSessionId` from settings.
2. The client resumes the existing provider session via the standard reconnect path.
3. Chat history is intact; no new session spawned.

### v0 Scenario 9 — System prompt customization

**Given** the operator opens `~/.attacca/arco-system.md`, adds "always respond in bullet points", and saves
**When** the operator asks Arco a follow-up question in the existing thread
**Then**:

1. The prompt change **does not** take effect until the Arco session is restarted (developer_instructions are set at thread start).
2. Settings UI shows a "Restart Arco" button that ends the session and starts a fresh one with the updated prompt.

### v0 Scenario 10 — Agent tries to push, sandbox rejects

**Given** Arco ignores the system prompt and issues `git push` via the shell tool
**When** the shell tool runs
**Then**:

1. The read-only sandbox blocks the write side of `git push` (ref update).
2. The command fails with a sandbox-denied error.
3. Agent reports the failure in chat and falls back to the command-coaching flow from Scenario 5.

## Open questions (resolve during implementation, not blocking v0)

1. **Exact semantics of `sandbox: "read-only"` in Codex**: does it block `git push` cleanly (no partial state), or does it let some network operations through? Verify during task 1 implementation by triggering a deliberate write in a test run.
2. **`approvalPolicy: "never"` + untrusted shell commands**: does Codex still guard obviously dangerous reads (e.g., `cat /etc/shadow`)? If not, the system prompt needs to reinforce scope. Verify early.
3. **System prompt editor on web mode**: no `pickFolder`-equivalent for opening files in the OS editor on web. Web mode shows the prompt inline as read-only with a "copy to clipboard" button. Good enough for v0.
4. **Git binary availability**: shell calls fail if git is not installed. Arco should respond gracefully and suggest the operator install git — this lives in the system prompt.
5. **Arco thread deletion**: what happens if the operator deletes the Arco session from the sidebar? Proposed: Arco auto-recreates on next `/arco` open (new session id, fresh history). Verify the sidebar actually shows Arco threads before deciding.
6. **System prompt quality**: the system prompt is now load-bearing (D3, D6). Plan for an iteration cycle after v0 ships where the operator tunes the prompt against real queries and we capture the tuned version as a new default.

## Dependencies

- **Phase 2 Podium** (shipped) — scanner, scan projects RPC, `attacca.user` identity, path validation.
- **C4 gap analysis** (shipped, `55fcead8`) — populates `gaps[]` on `ScannedProject`, which Arco references in its system prompt.
- **Recent commit `3cae83f2`** — `allowedRoots.ts` factoring unlocks future typed Arco RPCs in v1; not used directly in v0.
- **Codex app-server** — confirmed to support per-session `cwd` and per-turn `developer_instructions`. Does **not** support per-session tool allowlists; this shaped D3.
- **`packages/contracts/src/factory.ts`** — `ScannedProject`, `FactoryConfig`, `FactoryStatus`, `Gap` schemas referenced from the Arco system prompt so the agent knows what shapes it's reading.

## Out of scope (future work)

- **Typed Arco RPCs** — `arco.listProjects`, `arco.readFactoryFile`, `arco.gitDiff`, etc. v1 candidate if shell-based tool use proves noisy or expensive.
- **Arco writes** — queue dispatch, spec edits, session log authoring. v1 candidate.
- **Scheduled digests** — cron-driven morning brief messages. v1 candidate.
- **Multi-thread Arco** — per-topic threads, archive, search. v1+ if single-thread proves limiting.
- **Desktop / OS notifications**.
- **Forge skill invocation from Arco** — blocked on C3.6.
- **Arco executes shell commands that mutate state** — `gh repo create`, `git push`, etc. Operator copy-pastes in v0.
- **Codex MCP integration** — Path C from the D2 verification notes.
- **Multi-user Arco**.

## Review checklist

Before shipping v0:

- [ ] `RuntimeMode` schema includes `"read-only"`; `mapCodexRuntimeMode` maps it to `{ approvalPolicy: "never", sandbox: "read-only" }`.
- [ ] Every exhaustive switch on `RuntimeMode` in the web client handles the new value (lint/typecheck catches these).
- [ ] Arco session bootstrap sets `cwd = Podium root` and `runtimeMode = "read-only"`.
- [ ] `~/.attacca/arco-system.md` is created on first load from `docs/arco-system-prompt.md` and never silently overwritten after.
- [ ] `arcoSessionId` persists across reconnects; Scenario 8 passes.
- [ ] Scenario 6 passes: deliberate write attempt from the agent is blocked by sandbox.
- [ ] Scenario 7 passes: routine `git log` call does not prompt for approval.
- [ ] `ModeSwitcher` Arco tab is live (no more "Coming in Phase 3" tooltip) and routes to `/arco`.
- [ ] Arco system prompt covers: `.factory/` layout, gap severity/categories, four validated query recipes, explicit read-only reminders, and the "suggest commands, don't execute mutating ones" contract.
- [ ] All four validated queries (project state, gap triage, code review, GitHub push coaching) work end-to-end against a real factory with 2+ projects.
