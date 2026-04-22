# C3 — External intake flow (spec v0)

**Status**: shipped for local path intake, Git URL clone/import, and preset Forge handoff
**Date**: 2026-04-11
**Supersedes**: the C3 line item in `docs/phase-2-followups.md`.
**Relates to**: `docs/phase-2-podium-spec.md`, `docs/factory-protocol.md`, the `C2` path-validation work in `bb1b3041`.

**Implementation status note**: the shipped slice covers existing-directory intake, Git URL clone/import into the active Podium root, intake-root consent/persistence, idempotent `.factory/` initialization, draft-thread open, server-side brownfield auto-detection during init, and intake handoff via a preset Forge prompt (`spec-writer` for greenfield, `codebase-discovery` for brownfield). Automatic server-side Forge skill execution still remains deferred beyond the preset-prompt handoff.

---

## Purpose

Phase 2 v0 assumed every Attacca project lives under the configured Podium scan root. In practice, users have projects scattered across the filesystem — cloned into `~/work/client-a`, dropped into `D:\repos`, inside a worktree under `~/scratch`. Today Podium can't see those projects at all, and the only way to add one is to move it into the scan root first.

C3 closes that gap for the **"project already exists on disk"** case. Given a directory path that the user already has locally, Attacca should:

1. Register it as a tracked project (orchestration `project.create`).
2. Initialize a `.factory/` inside it with a default config.
3. Open a Stand-mode draft thread whose `cwd` is that directory.

That's it. No git cloning, no Forge skill invocation, no shell execution. Those are bigger sprints deferred to C3.5+ — see "Explicit non-behaviors" below.

## Resolved design decisions

These were the open questions the spec had to answer before code could start. Decisions are locked for v0 and each records the reasoning.

### D1. Intake flavors: F1 + F2 only for v0

- **F1** — file picker (desktop `window.desktopBridge.pickFolder`, falls back to text input on web mode).
- **F2** — paste an absolute path into a text input.
- **F3** (git URL clone) — **deferred to C3.5**. Touches git binary, clone auth, hooks that run arbitrary code at clone time, disk quota, partial-clone cleanup. Needs its own spec with a threat model.
- **F4** (Forge skill chain after init) — shipped in the narrower preset-prompt form; full server-side skill execution remains deferred. The current behavior opens the draft with the right Forge invocation seeded based on greenfield vs brownfield detection.

**Why defer**: F1 + F2 are cheap. They close the most common gap (my project is at `D:\repos\foo`, let me track it) without introducing a new attack surface or server-side git dependency. F3/F4 are each their own sprint with their own threat models.

### D2. Path containment: reuse C2 `FactoryPathError`, but relaxed for intake

C2 (`bb1b3041`) locks write RPCs to paths inside the resolved Podium scan root. Intake necessarily writes outside that root (that's the whole point), so v0 adds a second allowlist: **a client-settings list of additional "intake roots" that extend the path containment check**. When the user picks or pastes a directory during intake, the server adds the directory's parent (or the directory itself, whichever is more permissive for the user's mental model — see Q below) to the allowlist, then calls `initializeFactory`.

Concretely:

- New setting `externalIntakeRoots: string[]` in `ClientSettingsSchema` (default `[]`).
- `assertPathInsideScanRoot` on the server grows to `assertPathInsideAllowedRoot`, accepting an additional list of roots passed per-RPC from the client.
- The intake flow UI confirms with the user _once per new parent directory_: "Add `$parentDir` to intake roots?" (Yes / No / Ask every time). Yes persists, No is one-shot.

**Why**: preserves the C2 defense-in-depth for the common case (Podium writes only touch the scan root) while letting the user opt into specific external directories with explicit consent. Feels like how macOS/Windows file system permissions prompt users for access the first time an app reaches outside its sandbox.

**Open**: whether the allowlist stores _parent directories_ (so all siblings under `D:\repos` become valid once the user says yes once) or _exact project directories_ (each one prompts). Lean **parent directories** — matches user expectation that "I said D:\repos is OK" means all siblings are OK.

### D3. UX surface: new "Add project" button in the Podium header

Not a modal, not a settings page, not a slash command. A `<Button variant="outline">` with a `FolderPlusIcon` in the Podium dashboard header next to the Refresh button. Clicking it opens a small popover with two controls:

1. Text input: "Absolute path to project directory"
2. "Browse..." button (desktop only) that opens `window.desktopBridge.pickFolder()`

Pressing Enter or clicking "Add" triggers the intake flow.

**Why not a modal**: modals are heavyweight for what is essentially a two-field form. **Why not Sidebar**: Sidebar already has an "add project" button that creates an orchestration project from a path but does _not_ initialize `.factory/`. These are different semantics. Podium = "add + factory-init", Sidebar = "add only". Different button, different location, matches how users think about the modes.

**Why not a slash command**: discoverability. Users new to Attacca won't type `/attacca:intake` in their composer.

### D4. Trust tier for intake: default 2, user-editable

Matches the existing Podium Initialize button on Discovered rows. The intake flow creates a `.factory/config.yaml` with `trust_tier: 2`, phase `IDEA`, type auto-detected (brownfield if any of `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `pom.xml` exist; otherwise greenfield), track `software`. Users edit the config in Stand after the thread opens.

**Why**: intake is a low-friction flow; asking for trust tier at intake time adds ceremony. Most projects start in the tier-2 middle and get revised upward or downward as the user learns the codebase.

### D5. Duplicate handling: match by normalized absolute path

If the user intakes a path that already has a tracked orchestration project (matched by normalized absolute `cwd`), the intake flow **does not re-initialize**. Instead it:

1. Reuses the existing project ref.
2. Skips the `factory.initialize` call.
3. Calls `handleNewThread` to open a draft in the existing project (or focus the latest existing thread).

This matches the C1 row-click behavior for Podium-discovered projects that are already registered.

If the path is new to orchestration but already has a `.factory/` on disk (someone ran `factory init` manually, or another Attacca instance touched it), the intake flow **still calls `factory.initialize`** — it's idempotent because `initializeFactory` only writes if the files don't already exist, and overwriting a legitimate config would be destructive. **Open:** verify `initializeFactory` is actually idempotent — I think it overwrites today. If it does, intake needs to either skip init-if-exists or prompt to overwrite. Let's fix this during implementation.

### D6. Failure modes: explicit toast + row-level error, never silent

Every failure mode gets a visible error:

- **Path doesn't exist** → toast "No directory at `$path`" + input stays focused for retry.
- **Path is a file, not directory** → toast "Expected a directory, got a file" + input stays focused.
- **Path requires elevated permissions** → toast "Permission denied reading `$path`" + input stays focused.
- **Path is not in any allowed root and user declines to add it** → toast "Intake cancelled" + input stays focused. No server RPC call.
- **`project.create` fails** → toast with the dispatch error detail. No `.factory/` written.
- **`factory.initialize` fails after `project.create` succeeded** → toast with FactoryWriteError message + the new project stays registered (user can retry via Podium row click later, or delete manually). **Open:** should we roll back the `project.create` on init failure? That requires a new `project.delete` dispatch; might be worth it for symmetry but adds complexity. Defer until we see if this failure mode is common in practice.
- **Draft thread creation fails** → toast with the error + the new project + `.factory/` remain. User can navigate to Stand manually.

No silent failures, ever. Matches the B2 toast pattern from `f5ed5f62`.

## v0 scope

Five implementation tasks, in build order:

1. **Contracts: `externalIntakeRoots` setting + `assertPathInsideAllowedRoot`** — add the setting, extend `ScanProjectsInput` / write RPCs to accept an optional list of extra allowed roots, update `assertPathInsideScanRoot` on the server to check roots union instead of just the podium root. Export the helper for reuse.
2. **Idempotent `initializeFactory`** — make the writer a no-op when `.factory/config.yaml` already exists (or add a `force: boolean` flag for future overwrite UX). Smoke test: init twice, second call doesn't change file mtime.
3. **Intake store method** — add `usePodiumStore.intakeProjectFromPath(path: string)` that runs duplicate check, permission prompt, `project.create`, `factory.initialize`, `handleNewThread` in sequence. Exposes loading + error state.
4. **Intake button + popover** — new component `PodiumIntakePopover.tsx`, mounted in the Podium header. Text input with "Browse..." button on desktop. On submit, calls the store method. On error, surfaces toast + keeps the popover open.
5. **Settings: intake roots list** — extend the Stand settings panel with a "Intake roots" section that shows the current `externalIntakeRoots` list with "Remove" buttons next to each entry. No add-from-settings UI — roots are added only via the intake flow's consent prompt.

## v0 non-behaviors

Explicitly not building:

- **Git URL clone** (F3). Deferred to C3.5. This includes no `git` subprocess on the server, no clone auth prompting, no handling of `git clone` hook execution.
- **Server-side Forge skill execution after init**. Still deferred. The intake flow now opens a draft thread with the appropriate Forge handoff prompt prefilled, but it does not execute the skill automatically on the server.
- **Auto-scan intake roots**. The Podium dashboard still only scans the single podium root. Intake adds individual projects, not a second scan path. Multi-root scanning is separate (C5).
- **Project deletion or rollback** on intake failure. If init fails mid-flow, the user sees an error and has to clean up via Stand mode (or by deleting the registered project through existing UI).
- **Bulk intake**. One project at a time in v0. A future "import all projects from `$dir`" flow is out of scope.
- **Intake from a running worktree**. The user can point intake at a worktree path, but the flow does no special worktree handling — it treats the worktree like any other directory. If the worktree gets removed, the project's `cwd` becomes invalid, same as any other project.

## Integration boundaries

- **Server path validation**: the C2 `assertPathInsideScanRoot` helper grows to `assertPathInsideAllowedRoot(projectPath, extraRoots: string[])`. All write RPC handlers receive the allowlist from the client via an optional `allowedRoots` field on each input struct. Client sends `externalIntakeRoots` on every write call.
- **Client settings**: `externalIntakeRoots: Schema.Array(Schema.String)` with default `[]`. Stored alongside `attaccaUser`, `defaultMode`, `podiumScanRootOverride` in `ClientSettingsSchema`.
- **Consent prompt**: uses the existing `ensureLocalApi().dialogs.confirm` API that the sidebar already uses for destructive confirmations. Falls back to `window.confirm` on web mode.
- **Folder picker**: desktop-only via `window.desktopBridge.pickFolder()`. On web mode, the "Browse..." button is hidden — users can only paste paths.
- **No new RPC methods**. v0 reuses `factory.initialize` + existing `project.create` dispatch. The only contracts change is the allowlist plumbing on existing write RPCs + the `externalIntakeRoots` setting field.

## Behavioral scenarios

### v0 Scenario 1 — Intake an existing directory for the first time

**Given** the user is in Podium mode, has `externalIntakeRoots: []`, and has a project directory at `D:\repos\acme-api` with no existing `.factory/`
**When** the user clicks "Add project", pastes `D:\repos\acme-api`, clicks "Add"
**Then**:

1. A confirm dialog appears: "Add `D:\repos` to intake roots? Attacca will be able to write `.factory/` metadata in any project under this directory."
2. The user clicks Yes.
3. `externalIntakeRoots` persists `D:\repos`.
4. Server `project.create` dispatches with `workspaceRoot: D:\repos\acme-api`.
5. Server `factory.initialize` writes `.factory/config.yaml` (tier 2, phase IDEA, brownfield because of `package.json`), `.factory/status.json`, `.factory/context.md`, `.factory/CLAUDE.md`.
6. `handleNewThread` opens a draft thread in the new project.
7. User lands in Stand mode with the thread active, the sidebar expanded to show the new project, and the Factory panel auto-loaded.

### v0 Scenario 2 — Intake a sibling of an already-allowed root

**Given** the user previously intake'd `D:\repos\acme-api` and has `externalIntakeRoots: ["D:\\repos"]`, and now has another project at `D:\repos\widget-service`
**When** the user clicks "Add project", pastes `D:\repos\widget-service`, clicks "Add"
**Then**:

1. **No confirm dialog** — `D:\repos` is already an allowed root.
2. Server dispatches `project.create` + `factory.initialize` immediately.
3. Draft thread opens.

### v0 Scenario 3 — Intake a duplicate that's already registered

**Given** the user has a tracked project at `D:\repos\acme-api` (registered in orchestration, has `.factory/`)
**When** the user clicks "Add project", pastes `D:\repos\acme-api`, clicks "Add"
**Then** the intake flow:

1. Recognizes the path matches an existing registered project (via normalized absolute path comparison — same as C1's `normalizeCwd`).
2. Skips both `project.create` and `factory.initialize`.
3. Calls `handleNewThread` on the existing project ref, which opens a new draft (or reuses an existing one).
4. Closes the intake popover.
5. No duplicate project is created.

### v0 Scenario 4 — Intake a non-existent path

**Given** the user has `D:\repos` allowlisted
**When** the user pastes `D:\repos\does-not-exist` and clicks "Add"
**Then**:

1. Client calls `factory.initialize` → server detects the path doesn't exist via `existsSync`.
2. Server returns a `FactoryWriteError` with a specific message.
3. UI renders a toast: "Directory `D:\repos\does-not-exist` does not exist."
4. Popover stays open. No project is created.

(**Open:** should the client pre-check existence before the RPC? It can't on web mode — there's no filesystem API. On desktop it could via a new `dialogs.pathExists` bridge, but that adds surface. Lean: let the server be authoritative, surface the error via toast. Matches how other failures are handled.)

### v0 Scenario 5 — User declines the consent prompt

**Given** no directories are allowlisted yet
**When** the user clicks "Add project", pastes `/home/user/work/foo`, clicks "Add", and clicks **No** on the "Add `/home/user/work` to intake roots?" prompt
**Then**:

1. No server RPC is called.
2. Toast: "Intake cancelled".
3. Popover stays open. Input keeps its value so the user can try a different path or reconsider.

### v0 Scenario 6 — Intake a path under the existing podium scan root

**Given** the Podium scan root is `C:\Users\jhon1\projects` and the user pastes `C:\Users\jhon1\projects\brand-new-thing` (which happens to exist but wasn't in the last scan, or is a sibling they want to fast-track)
**When** they click "Add"
**Then**:

1. Path is already under the scan root, no allowlist prompt needed.
2. Server `project.create` + `factory.initialize` run.
3. Thread opens.
4. On the next Podium refresh, the project appears in Tracked (not Discovered).

### v0 Scenario 7 — Desktop folder picker flow

**Given** the user is running the desktop build
**When** they click "Add project" and then the "Browse..." button
**Then**:

1. `window.desktopBridge.pickFolder()` opens the native OS folder picker.
2. The picked path populates the text input.
3. The user can edit the path or click "Add" to proceed.
4. From here the flow is identical to the paste-path flow (scenarios 1–6).

### v0 Scenario 8 — Intake on web mode (no desktop bridge)

**Given** the user is running the web build (`bun run dev:web` without the desktop shell)
**When** they click "Add project"
**Then**:

1. The "Browse..." button is hidden.
2. Only the text input is shown, with placeholder "Paste an absolute path".
3. The user must paste or type the path manually.
4. The consent prompt uses `window.confirm` since there's no desktop dialog bridge.

## Open questions (resolve during implementation, not blocking v0 spec)

1. **Idempotent `initializeFactory`?** The writer currently overwrites existing `.factory/config.yaml` each call. For intake of a path that already has a `.factory/`, overwriting is destructive. Fix: check `existsSync(configPath)` before writing and skip if present. Or add a `force: boolean` param. The safer default is skip-if-exists.
2. **Allowlist granularity**: parent directory (as proposed) vs exact project directory vs single global "allow any external path" bypass. Parent directory is the current pick, but if users end up allowlisting many siblings and the consent prompt spam becomes annoying, we might add a bypass.
3. **Server-side existence check vs client-side**: see scenario 4 open note. Lean server-side for now.
4. **Pre-scan intake candidates**: once a parent directory is allowlisted, should Podium offer to scan _it_ in a second section? That's basically C5 multi-root scanning. Out of scope for C3.

## Dependencies

- **C2 path validation** (`bb1b3041`) — intake extends the `assertPathInsideScanRoot` helper. C2 must ship before C3 can.
- **C7 settings UI** (`8b3c794d`) — intake adds a new section to the existing Stand settings panel.
- **C1 row click** (`3c5f0d79`) — intake's duplicate-handling logic reuses the `normalizeCwd` helper.

All three dependencies are shipped.

## Out of scope (future work)

- **C3.5 — git URL clone** (F3)
- **C3.6 — server-side Forge skill execution after intake** (beyond the shipped preset-prompt handoff)
- **Bulk intake** from a parent directory
- **Project rollback** on mid-flow failure
- **Worktree-specific intake** handling
- **Intake from archive** (zip, tarball)

## Review checklist

Before I start building v0, confirm:

- [ ] F1 + F2 scope (no git clone, no Forge skill chain) is the right v0 line.
- [ ] Parent-directory allowlist granularity is the right default.
- [ ] Podium header button is the right UX surface (not modal, not sidebar, not slash command).
- [ ] Trust tier 2 default + auto-detected greenfield/brownfield is the right default.
- [ ] Duplicate detection via normalized absolute path reuses C1's approach correctly.
- [ ] Idempotent `initializeFactory` fix is in scope (safer default: skip-if-exists).
- [ ] Server-side existence check (not client) is the right failure-mode design.
- [ ] The build order (contracts → idempotent init → store → UI → settings) has no hidden dependencies.
