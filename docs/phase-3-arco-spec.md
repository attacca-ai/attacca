# Phase 3 — Arco Mode (spec v0)

**Status**: locked — design decisions resolved, ready to build
**Date**: 2026-04-21
**Relates to**: `docs/phase-2-podium-spec.md`, `docs/factory-protocol.md`, `packages/contracts/src/factory.ts`.

---

## Purpose

Stand pairs one developer with one project. Podium shows the operator every project at once. Arco is the third leg of the stool: the **personal always-on agent** that reads across all tracked projects and helps the operator act on what's there without having to click into each one.

Where Podium answers "what's in my factory right now?", Arco answers "what should I do with it?" and "what happened while I was away?". It's the digest / brief / copilot surface — a persistent conversation bound to the operator, not to any single project.

Four user queries Arco v0 is validated against (driven directly by operator-stated examples):

1. **Project state** — "where are we with this project?" (status + phase + recent activity + pending queue).
2. **Gap triage** — "what gap do we need to solve?" (sorted C4 gap list, highest severity first).
3. **Code review** — "review this diff" (inline review of a bounded git patch).
4. **GitHub push coaching** — "help me push this project to GitHub" (state check + copy-pasteable shell commands; Arco never executes).

v0 is scoped to a **chat surface with read-only tools over `.factory/` and git**. Arco does not write code, dispatch work, invoke Forge skills, or run shell commands on its own. Those are v1+ concerns.

## Resolved design decisions

### D1. Single durable Arco thread per install (H1)

One Arco thread per Attacca install, persisted as a normal Codex session marked `scope: "arco"` so it's hidden from per-project thread lists. No per-conversation branching in v0 — a "new conversation" UI action clears local message history but keeps the same Codex session so cross-turn context continuity is preserved.

**Why**: Arco is a personal assistant, not a topic inbox. Multi-thread pickers/archives add UI surface with no clear v0 benefit. Single thread is simpler to build, simpler to reason about, and easy to split later if it becomes limiting.

### D2. Reuse Codex app-server pipeline (H2)

Arco is a Codex app-server provider session like Stand. Differences are parameterization only: `cwd` = Podium root, system prompt comes from `~/.attacca/arco-system.md`, tool manifest is restricted to Arco read RPCs.

**Why**: zero new integration. The Codex plumbing in `apps/server/src/codexAppServerManager.ts` + `providerManager.ts` already handles session lifecycle, streaming, and reconnects. No parallel provider surface to maintain.

**Implementation risk to flag early**: if the Codex app-server does not support a restricted per-session tool manifest, this forces either extending the manager or scoping Arco tools globally. Verify in task 3 before committing to the full scope.

### D3. Six read-only tools (H3)

Arco's v0 tool manifest, all read-only:

- `arco.listProjects()` → same `ScannedProject[]` the Podium scanner produces, including the C4 `gaps[]` field.
- `arco.readFactoryFile({ projectPath, relativePath })` → read any whitelisted file under `.factory/` (config.yaml, status.json, spec.md, context.md, queue.json, sync-status.json, scenarios.md, intent-contract.md, session logs under `progress/`, decisions under `decisions/`).
- `arco.listSessionLogs({ projectPath, sinceIso? })` → list session log filenames + first-line summaries, filtered by date.
- `arco.gitLog({ projectPath, sinceIso?, maxCount? })` → `git log --oneline --since=<iso>` with `maxCount` cap.
- `arco.gitDiffStat({ projectPath, ref?, sinceIso? })` → `git diff --stat` between HEAD and either a ref or a date.
- `arco.gitDiff({ projectPath, ref?, sinceIso?, maxBytes? })` → full patch content bounded by `maxBytes` (default 50KB). Required for query #3 (code review).

Every tool routes through `assertPathInsideAllowedRoot(projectPath, externalIntakeRoots)` from `apps/server/src/factory/allowedRoots.ts` and uses `GitCore.executeGit` for git operations. No arbitrary `fs.readFile`, no arbitrary shell surface.

**Why six and not more**: these six cover all four validated queries. Source-file reads (for "grep TODO across repos" or deep review with full-file context) are deferred to v1 — operators can open Stand and run `/review` when diff-only review is insufficient.

### D4. Zero writes in v0 (H4)

Arco cannot write to disk, cannot dispatch work packages, cannot invoke Forge skills, cannot execute shell commands, and cannot push to git remotes. The tool manifest contains read-only RPCs exclusively.

**Why**: write-from-chat needs a confirmation UX (undo, diff preview) that doesn't exist in the chat surface today. Read-only Arco ships clean and gives operators a mental model ("Arco reads and advises; I execute") that scales to v1 without breaking.

**Friction acknowledged**: query #4 ("help me push to GitHub") resolves to Arco **generating** the commands and the operator pasting them into a terminal. This is intentional — it keeps Arco read-only while still covering the coaching use case.

### D5. Manual trigger only (H5)

The Arco tab in `ModeSwitcher` becomes live (no more "Coming in Phase 3" tooltip) and routes to `/arco`. No background polling, no scheduled digests, no OS notifications in v0. "Always-on" means always _available_, not always _running_.

**Why**: scheduled digests need a background runner + delivery channel (in-thread message? toast?) that warrants its own spec. Manual trigger is good enough to prove the value loop — if the operator opens Arco and gets useful answers, scheduled digests become worth building.

### D6. User-editable system prompt (H6)

The system prompt lives at `~/.attacca/arco-system.md`. Attacca ships a canonical default at `docs/arco-system-prompt.md` and copies it to the user's home dir on first Arco load. The user is free to edit the file in their editor of choice; a "Restart Arco" button in settings ends the current session and starts a new one with the updated prompt.

**Why**: prompt tuning is how the operator will make Arco useful over time. Locking the prompt forces a code change for every tuning iteration. A "Restore defaults" action is a safety net.

### D7. Identity inherited from `attacca.user` (H7)

Arco reuses the `attacca.user` client-settings identity established in Phase 2. No separate "Arco identity" field. Single-operator installs treat Arco as their assistant; multi-seat semantics are deferred until Attacca ships a hosted/team product.

**Why**: speculative multi-user complexity cost now, zero gain for single-operator v0. Adding a `contributors[]` or per-agent identity later is cheap.

## v0 scope

Seven implementation tasks in build order:

1. **Contracts: Arco RPC surface** — new `packages/contracts/src/arco.ts` with input/result schemas for the six tools (`ArcoListProjects`, `ArcoReadFactoryFile`, `ArcoListSessionLogs`, `ArcoGitLog`, `ArcoGitDiffStat`, `ArcoGitDiff`) and an `ArcoError` union reusing `FactoryPathError` + `GitCommandError` + a new `ArcoFilePolicyError` for whitelist violations. Register methods in `packages/contracts/src/rpc.ts` under `arco.*` keys.

2. **Server: Arco RPC handlers** — new `apps/server/src/arco/ArcoRpc.ts`. Each handler calls `assertPathInsideAllowedRoot` on `projectPath` first. `listProjects` delegates to `scanProjectsDetailed`. `readFactoryFile` enforces the file whitelist (D3) and reads via the existing factory reader helpers. `listSessionLogs` lists under `.factory/progress/`. `gitLog`/`gitDiffStat`/`gitDiff` delegate to `GitCore.executeGit` with hardened config and bounded `maxOutputBytes`. Wire into `apps/server/src/ws.ts` under a new `arco` aggregate.

3. **Server: Arco session bootstrap** — new helper in `apps/server/src/arco/session.ts` that starts a Codex provider session with `cwd = resolvePodiumRoot().rootDir`, a system prompt loaded from `~/.attacca/arco-system.md` (created from `docs/arco-system-prompt.md` on first launch), and a tool manifest restricted to the six `arco.*` RPCs. Persist the session ID in client settings as `arcoSessionId` so reconnects resume the same session. **Verify D2 risk early**: confirm the app-server supports per-session tool manifests before committing to the full scope.

4. **Client: `/arco` route** — new `apps/web/src/routes/_chat.arco.tsx`. Reuses the existing chat composer, event renderer, and streaming plumbing from Stand. Removes the project header, queue panel, and Forge skill menu. Adds a "Scope: Arco" badge in the header. Composer placeholder reads "Ask Arco about your factory...".

5. **Client: Arco store** — new `apps/web/src/stores/arco.ts` holding session id, message history, streaming state, and `refresh()` action for re-listing projects. Selectors: `selectArcoThreadMessages`, `selectIsArcoStreaming`.

6. **Client: `ModeSwitcher` Arco enablement** — in `apps/web/src/components/ModeSwitcher.tsx` remove the `disabled` state and "Coming in Phase 3" tooltip on the Arco tab. Add `arco` handling to `resolveCurrentMode`. Wire the click to `navigate({ to: "/arco" })`.

7. **Defaults + system prompt + settings** — ship `docs/arco-system-prompt.md` as the default. Add `arcoSessionId: Schema.NullOr(Schema.String)` and `arcoSystemPromptPath: Schema.NullOr(Schema.String)` to `ClientSettingsSchema`. Settings UI: "Arco" section with a "Restart Arco session" button (clears `arcoSessionId`), a read-only path display, and a "Restore default prompt" button (overwrites `~/.attacca/arco-system.md` from the canonical default).

## v0 non-behaviors

Explicitly **not** building:

- **Writing to disk** — no queue updates, no spec edits, no session log authoring by Arco (D4).
- **Shell execution / git push / GitHub API calls** — Arco generates commands, the operator runs them. Arco has no shell or network-write surface (D4).
- **Scheduled digests / background polling / OS notifications** — manual trigger only (D5).
- **Multi-thread Arco** — single durable thread per install (D1).
- **Source-file reads** — `readSourceFile` / `grep` tools deferred to v1. Deep review uses Stand's `/review`.
- **Forge skill invocation from Arco** — same blocker as C3.6.
- **Custom user tools** — tool manifest is fixed in v0.
- **Arco writes session logs** — no `progress/arco-YYYY-MM-DD.json`. Deferred to v1.
- **Proactive nudges** — Arco responds, doesn't initiate.
- **Multi-user / multi-seat semantics** — single `attacca.user` identity (D7).

## Integration boundaries

- **Scanner** (`apps/server/src/scanner/`): `arco.listProjects` reuses `scanProjectsDetailed`. No scanner changes.
- **Factory reader** (`apps/server/src/factory/`): `arco.readFactoryFile` reuses `readFactorySummary` for config/status and adds a `readFactoryFileByName` helper that validates the relative-path whitelist from D3.
- **Git core** (`apps/server/src/git/Layers/GitCore.ts`): `arco.gitLog`, `arco.gitDiffStat`, `arco.gitDiff` call `GitCore.executeGit` with hardened config args and per-call `maxOutputBytes`. No new git subcommands added to `GitCore`.
- **Path validation** (`apps/server/src/factory/allowedRoots.ts`): every Arco RPC calls `assertPathInsideAllowedRoot(projectPath, externalIntakeRoots)` before filesystem access.
- **Codex app-server manager** (`apps/server/src/codexAppServerManager.ts`): needs to accept a per-session tool manifest + explicit `cwd` at session start. If absent, task 3 extends the manager.
- **Orchestration manager** (`apps/server/src/providerManager.ts`): Arco's provider session is registered like Stand's, scoped to the Arco thread id. Streaming reuses `orchestration.domainEvent` with events tagged `scope: "arco"`.
- **WebSocket router** (`apps/server/src/ws.ts`): new `arco` aggregate.
- **Router** (`apps/web/src/routes/_chat.arco.tsx`): TanStack Router file-based. Must not conflict with `_chat.podium.tsx` or `_chat.$environmentId.$threadId.tsx`.
- **Settings** (`packages/contracts/src/settings.ts`): `arcoSessionId`, `arcoSystemPromptPath` added to `ClientSettingsSchema` with nullable defaults.

## Behavioral scenarios

### v0 Scenario 1 — First Arco open (Arco tab goes live)

**Given** a user on an install that just shipped Arco
**When** they click the Arco tab in `ModeSwitcher`
**Then**:

1. App navigates to `/arco`.
2. Server creates `~/.attacca/arco-system.md` from the default template if missing.
3. Server starts a Codex session with `cwd` = Podium root and the restricted Arco tool manifest.
4. Composer is empty and focused, placeholder "Ask Arco about your factory...".
5. No system message is shown in chat — the system prompt is invisible.

### v0 Scenario 2 — "Where are we with this project?"

**Given** the operator has 4 tracked projects; asks "where are we with acme-api?"
**When** Arco processes the query
**Then**:

1. Arco calls `arco.listProjects()` → finds `acme-api`.
2. Arco calls `arco.readFactoryFile({ path, relativePath: "status.json" })` + `spec.md` + `queue.json`.
3. Arco calls `arco.listSessionLogs({ path, sinceIso: <7 days ago> })`.
4. Arco calls `arco.gitLog({ path, sinceIso: <7 days ago>, maxCount: 20 })`.
5. Response summarizes phase, trust tier, last session, pending queue items, and recent commits.

### v0 Scenario 3 — "What gap do we need to solve?"

**Given** the operator asks "what's the top gap I should fix right now?"
**When** Arco processes the query
**Then**:

1. Arco calls `arco.listProjects()` → reads `gaps: Gap[]` from each `ScannedProject`.
2. Arco ranks by severity (high > medium > low) then by project staleness.
3. Response names the top gap (e.g., "missing_spec on widget-service, medium severity") with the gap's message and the `suggestedSkill` field from C4.
4. Arco reminds the operator to dispatch from Podium (D4 — Arco cannot dispatch itself).

### v0 Scenario 4 — "Run a code review"

**Given** the operator says "review the diff on feature/gap-dispatch vs main for this project"
**When** Arco processes the query
**Then**:

1. Arco calls `arco.gitDiff({ projectPath, ref: "main..feature/gap-dispatch", maxBytes: 50000 })`.
2. If the diff exceeds `maxBytes`, Arco gets a truncated patch and notes that in the response.
3. Arco reviews the patch content inline and outputs findings (bugs, style nits, suggestions).
4. Arco never writes inline comments or modifies files. The operator acts on findings manually or runs `/review` in Stand for deep review.

### v0 Scenario 5 — "Help me push this project to GitHub"

**Given** the operator asks "help me push widget-service to GitHub"
**When** Arco processes the query
**Then**:

1. Arco calls `arco.readFactoryFile({ path, relativePath: "config.yaml" })` to read `repo` field.
2. Arco calls `arco.gitLog` to check for unpushed commits and `arco.gitDiffStat` to check working-tree state.
3. Response outputs precondition summary ("3 commits ahead, clean working tree, no remote configured") plus copy-pasteable shell commands:

   ```
   gh repo create attacca-ai/widget-service --private
   git remote add origin git@github.com:attacca-ai/widget-service.git
   git push -u origin main
   ```

4. Arco never executes any of these commands. The operator runs them in a terminal (Stand shell, external terminal, or desktop app).

### v0 Scenario 6 — Path validation failure

**Given** a bug in the prompt causes Arco to request `arco.readFactoryFile({ projectPath: "C:\\Windows\\System32", relativePath: "config.yaml" })`
**When** the server receives the RPC
**Then**:

1. `assertPathInsideAllowedRoot` throws `FactoryPathError`.
2. The tool call returns the error to the agent.
3. Arco explains the failure in chat instead of looping.

### v0 Scenario 7 — File whitelist violation

**Given** Arco requests `arco.readFactoryFile({ projectPath: <valid>, relativePath: "../../.env" })`
**When** the server receives the RPC
**Then**:

1. The file whitelist check fails (the path escapes `.factory/` and is not in the allowed list).
2. The server returns `ArcoFilePolicyError`.
3. Arco explains the limitation and suggests the operator open the file manually if needed.

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

1. The prompt change **does not** take effect until the Arco session is restarted (system prompt is captured at session start).
2. Settings UI shows a "Restart Arco" button that ends the session and starts a fresh one with the updated prompt.

### v0 Scenario 10 — Diff exceeds max bytes

**Given** the operator asks to review a diff that is 200KB
**When** Arco calls `arco.gitDiff({ maxBytes: 50000 })`
**Then**:

1. The server returns the first 50KB of the patch with a `truncated: true` flag.
2. Arco's review explicitly notes "the diff is truncated; I can only review the first chunk".
3. Arco suggests splitting the review per-file or using Stand's `/review` for the full diff.

## Open questions (resolve during implementation, not blocking v0)

1. **Per-session tool manifest support in Codex app-server**: task 3 verifies this before committing to the full scope. If unsupported, either (a) extend `codexAppServerManager` to accept a per-session tool allowlist, or (b) register Arco tools globally and rely on the agent's system prompt to stay within the allowed set (weaker guarantee).
2. **`git log` / `git diff` output caps**: `GitCore`'s defaults may be too generous for Arco's context budget. Per-call caps: `gitLog` 20KB, `gitDiffStat` 20KB, `gitDiff` 50KB. Tune during implementation based on real usage.
3. **Empty-state messaging**: if the operator has zero tracked projects, first-open Arco should say "You don't have any tracked projects yet. Add one from Podium." rather than confusing the agent with an empty `listProjects` result.
4. **System prompt editor on web mode**: no `pickFolder`-equivalent for opening files in the OS editor on web. Web mode shows the prompt inline as read-only with a "copy to clipboard" button. Good enough for v0.
5. **Git binary availability**: Arco's git tools fail if git is not installed. `GitCore` already surfaces this; Arco should respond gracefully ("git not available on this host") instead of erroring the tool call.
6. **Arco thread deletion**: what happens if the operator deletes the Arco session from the sidebar? Proposed: Arco auto-recreates on next `/arco` open (new session id, fresh history). Verify the sidebar actually shows Arco threads before deciding.

## Dependencies

- **Phase 2 Podium** (shipped) — scanner, scan projects RPC, `attacca.user` identity, path validation.
- **C4 gap analysis** (shipped, `55fcead8`) — populates `gaps[]` on `ScannedProject`, which Arco reads directly for Scenario 3.
- **Recent commit `3cae83f2`** — `allowedRoots.ts` factoring means Arco reuses the same path check as Factory + Git RPCs with no duplication.
- **`GitCore`** — bounded command execution; reused as-is for all three git tools.
- **Codex app-server** — must support restricted tool manifest + explicit `cwd` at session start. Flagged as implementation risk in D2.
- **`packages/contracts/src/factory.ts`** — `ScannedProject`, `FactoryConfig`, `FactoryStatus`, `Gap` already sufficient for Arco's read surface.

## Out of scope (future work)

- **Arco writes** — queue dispatch, spec edits, session log authoring. v1 candidate.
- **Scheduled digests** — cron-driven morning brief messages. v1 candidate.
- **Multi-thread Arco** — per-topic threads, archive, search. v1+ if single-thread proves limiting.
- **Desktop / OS notifications** — push when a gap resolves or a stalled project wakes up.
- **Forge skill invocation from Arco** — same blocker as C3.6.
- **Source-file read tools** — `readSourceFile`, `grep`. Defer to a focused spec.
- **Arco executes shell commands** — `gh repo create`, `git push`, etc. Operator copy-pastes in v0.
- **Arco-to-Stand handoff** — "open this project in Stand with the following prompt" as a one-click action from Arco.
- **Multi-user Arco** — shared thread across teammates. Requires real auth, outside current architecture.

## Review checklist

Before shipping v0:

- [ ] All six Arco RPCs go through `assertPathInsideAllowedRoot` before filesystem or git access.
- [ ] `readFactoryFile` whitelist is enforced; arbitrary relative paths outside `.factory/` fail with `ArcoFilePolicyError`.
- [ ] Arco tool manifest contains only the six `arco.*` RPCs — no write tools, no shell, no Forge skills.
- [ ] `~/.attacca/arco-system.md` is created on first load from `docs/arco-system-prompt.md` and never silently overwritten after.
- [ ] `arcoSessionId` persists across reconnects; Scenario 8 passes.
- [ ] Git output is bounded per-call; Scenario 10 passes.
- [ ] `ModeSwitcher` Arco tab is live (no more "Coming in Phase 3" tooltip) and routes to `/arco`.
- [ ] Task 3 verified Codex app-server supports per-session tool manifests before the rest of the client UI was built.
- [ ] The four validated queries (project state, gap triage, code review, GitHub push coaching) all work end-to-end against a real factory with 2+ projects.
