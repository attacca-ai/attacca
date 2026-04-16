# Phase 2 — Podium Mode (spec v0)

**Status**: locked — open questions resolved, ready to build
**Date**: 2026-04-11
**Supersedes**: the Phase 2 task list in `01-Projects/attacca.md` (dark-factory vault), which omits intake.
**Relates to**: `docs/factory-protocol.md`, `packages/contracts/src/factory.ts`.

---

## Purpose

Podium is the cross-project view of the factory. Where Stand pairs one developer with one project's agent, Podium pairs one operator (or developer wearing the operator hat) with *every* project they're responsible for. It exists to answer three questions:

1. **What's here?** — show me everything with a `.factory/`, plus anything in my project root that could become one.
2. **What needs me?** — surface projects that are stalled, blocked, or have work queued up.
3. **How do I add a project?** — take a directory and make it factory-tracked.

Phase 2 v0 answers #1 and #3 with code we already shipped in Phase 1. It answers #2 with basic heuristics only — "stalled" means last session > 7 days ago, "has work" means queue has pending items. Real gap analysis is explicitly deferred.

## Mode enforcement (decision)

**All three modes (Stand / Podium / Arco) are always available to every user.** Modes are *views*, not permissions.

- A `defaultMode: "stand" | "podium" | "arco"` preference lives in the client-side settings JSON and determines which mode the app opens in.
- Per-project `.factory/config.yaml` has an optional `assigned_dev` field, *displayed* in the Podium dashboard and Stand panel but *not enforced*. `assigned_dev` is interpreted as **the single accountable owner**, not a team list.
- When the current user's Attacca identity differs from `assigned_dev`, a neutral attribution banner reads "**Owned by @{dev}**". It's not framed as "guest" or "wrong user" — just accurate attribution that's invisible when you *are* the owner. Team collaborators see the banner when contributing to someone else's project, which is correct.
- Identity comes from the `attacca.user` client setting, bootstrapped from `git config user.name` on first launch but user-overridable thereafter (see "Identity" section below).
- No auth, no server-side identity, no role table.

**Why**: the Dark Factory methodology is about compressing coordination overhead. Locking a developer out of Podium when they need to see what the factory scheduled them would reintroduce the friction the methodology exists to remove. Adding real auth is an architectural decision that should be driven by a specific product need (a hosted/multi-seat product), not by a hypothetical permission requirement.

**Revisit when**: shipping Attacca as a hosted or multi-seat product, or when per-project operator lists stop being advisory in practice. If a real contributor list is needed later, add it as a separate `contributors: string[]` field — do not union it into `assigned_dev`.

## Identity (decision)

**Git is a bootstrap, not an authority.** The `attacca.user` client setting is the single source of truth for who the current user is. Everything downstream — session log `dev` field, `assigned_dev` comparison, attribution banner — reads from `attacca.user`, **never** from git directly.

Flow:

1. First launch: read `git config --global user.name`. If empty, fall back to the OS username. If that's also empty, leave `attacca.user` blank.
2. Store the result in client settings JSON as `attacca.user`.
3. The settings UI exposes it as a single editable text field "Your Attacca identity" with the git-derived value pre-filled. Users can override at any time.
4. If `attacca.user` is blank, the attribution banner never shows (we can't compare identities) and session logs record `dev: "unknown"`.

**Retroactive fix**: Phase 1 task #6 hardcoded `dev="developer"` in the session log. That wiring moves to read from `attacca.user` as part of v0 task #7.

**Spec change rationale**: git config is a fine first guess but a terrible authoritative source — forks, worktrees, work-vs-personal email accounts, and multi-account SSH setups all break it. Let users tell Attacca who they are, once, and believe them.

---

## v0 scope

Eight items. Five from `attacca.md` minus #3 and #4, plus intake, protocol versioning, and identity plumbing.

1. **Scanner RPC** — expose the existing `scanProjects(rootDir)` function from `apps/server/src/scanner/index.ts` as `factory.scanProjects` over WebSocket. Input: `{ rootDir: string }`. Output: `ScannedProject[]`. The scanner respects the existing `EXCLUDE` set plus any names listed in `ATTACCA_PODIUM_EXCLUDE` (comma-separated env var).
2. **Podium store** — Zustand store (separate from factory store, or a new slice) holding the scan result, loading state, and the selected project.
3. **Dashboard route** — `/podium` under the existing `_chat.tsx` layout route. Renders three sections:
   - **Tracked** — projects with `.factory/`, sorted by `lastActivity DESC`. Each row shows `displayName`, phase badge, trust tier, health, gap count, pending queue count, `assigned_dev`. Clicking a row navigates to its Stand thread (or to an empty chat in that project's `cwd` if there's no active thread).
   - **Discovered** — directories under the root without `.factory/`. Each row has an **Initialize** button that calls the existing `factory.initialize` RPC with a minimal default config (phase `IDEA`, trust tier `2`, type `greenfield`, track `software`). After success, the project moves from Discovered to Tracked on the next scan.
   - **Stalled / Needs attention** — computed client-side from Tracked projects where `lastActivity` is > 7 days old or `gapCount > 0`. Same row shape, just a visual filter. Not a separate data source.
4. **Mode switching** — a three-way toggle at the top of the existing `Sidebar` component: `Stand | Podium | Arco`. Routes:
   - `Stand` → the currently active chat route (current behavior).
   - `Podium` → `/podium`.
   - `Arco` → **disabled for v0**, tooltip "Coming in Phase 3".
   Toggle state drives the route; it doesn't filter the UI.
5. **Project intake via Initialize** — the "Initialize" button on Discovered rows closes the loop for flavors 1 (project I just cloned) and 2 (project I created and forgot to factory-ify). Uses the server writer we already shipped in Phase 0; no new code required beyond the button.
6. **Settings: `defaultMode`** — add a `defaultMode` field to client settings, default `"stand"`. On app startup, the router uses it to pick the initial route.
7. **Settings: `attacca.user` + identity bootstrap** — add `attacca.user: string` to client settings. On first launch, bootstrap from `git config --global user.name` (server-side RPC call), fall back to OS username, then blank. Settings UI exposes it as an editable field. The Phase 1 session log `dev` field and the new "Owned by @{dev}" attribution banner both read from this setting. Retroactively replaces the `dev="developer"` hardcoding from Phase 1 task #6.
8. **`.factory/` protocol versioning** — add `version: number` to `FactoryConfig` schema, exported as `FACTORY_PROTOCOL_VERSION = 1` constant from contracts. Reader migrates missing version → 1 for backward compatibility, throws typed `FactoryProtocolVersionError` if `version > FACTORY_PROTOCOL_VERSION`. Writer always writes the current version. The error's message is user-facing: "This project uses .factory/ protocol v{N} but this Attacca client supports up to v{M}. Update Attacca or downgrade the project." This is free insurance — adds maybe 20 lines now, saves migration headaches later when we ship protocol v2.

## v0 non-behaviors

Things I am deliberately **not** building in v0:

- **Gap analysis engine.** The `gapCount` field on a ScannedProject comes from `.factory/status.json` as-is. No pattern matching over spec/tests/code.
- **Work package generator or queue dispatch.** Podium does not write to `.factory/queue.json` in v0. Users can still edit queues through Stand.
- **External intake flow** (flavor 3 — take a GitHub URL or directory path that isn't already under the project root, clone it, run a Forge skill to generate a spec, initialize). This is a Phase 2.5 sprint with its own spec.
- **Real auth or role enforcement.** `assigned_dev` is advisory, interpreted as single accountable owner only.
- **Discovered-project dismiss / ignore list UI.** The existing `EXCLUDE` set + the `ATTACCA_PODIUM_EXCLUDE` env override are the only filter controls in v0. If the Discovered section becomes painful in testing, a per-project Dismiss button is a fast v0.5 follow-up.
- **Scan scheduling or watchers.** Scans are triggered by user action (clicking a Refresh button or navigating to `/podium`). No background polling.
- **Multi-root scanning.** One root directory per scan. Multi-root comes when `rootDir` becomes a list in settings — likely Phase 2.5.
- **AOME dashboards.** Phase 4 territory.
- **Contributor lists.** If a real multi-user membership concept is needed later, it lands as a new `contributors: string[]` field — not a widening of `assigned_dev`.

## Integration boundaries

- **Scanner root** (v0): hardcoded to `C:\Users\jhon1\projects\` with an env var override (`ATTACCA_PODIUM_ROOT`). Settings-UI override is Phase 2.5.
- **Scanner exclusions**: the hardcoded `EXCLUDE` set in `apps/server/src/scanner/index.ts` (`node_modules`, `.git`, `.next`, `.turbo`, `dist`, `attacca`) is augmented by a comma-separated `ATTACCA_PODIUM_EXCLUDE` env var. No settings UI for this in v0.
- **Initialize default config**: phase `IDEA`, trust tier `2`, type `greenfield`, track `software`, `name` and `display_name` derived from the directory name. Users edit in Stand after initialization. Config includes `version: 1`.
- **Identity**: the `attacca.user` client setting is the single source of truth. Bootstrapped from `git config --global user.name` via a new `factory.getGitIdentity` server RPC on first launch, cached in settings, never re-read from git. Downstream consumers (session log `dev` field, attribution banner) read settings only.
- **Attribution banner**: "Owned by @{assigned_dev}" renders in the Factory panel header whenever `assigned_dev` is set and does not equal `attacca.user`. Dismissible per-session (not per-project). Never shows when `attacca.user` is blank.
- **Protocol version**: `FACTORY_PROTOCOL_VERSION = 1` lives in `packages/contracts/src/factory.ts`. The reader treats missing `version` in legacy configs as `1` for backward compat, and throws `FactoryProtocolVersionError` for any `version > FACTORY_PROTOCOL_VERSION`. The error is typed in contracts so both server and web can pattern-match it.
- **Router**: TanStack Router, file-based. New route file `apps/web/src/routes/_chat.podium.tsx`. Must not break the existing `_chat.$environmentId.$threadId.tsx` deep links.
- **Store separation**: the existing `factoryStore` stays per-project. New `podiumStore` owns the scan result and selected project. They can both read each other but neither writes to the other's state.

## Behavioral scenarios

These are the scenarios I'll build against. Each is a specific user-visible behavior with a specific assertion.

### v0 Scenario 1 — First-time Podium open

**Given** a fresh install and a root directory containing 3 projects (2 with `.factory/`, 1 without)
**When** the user clicks the Podium tab in the sidebar for the first time
**Then** the `/podium` route loads, triggers a scan automatically, and renders:
- 2 rows in Tracked (sorted by `lastActivity DESC`)
- 1 row in Discovered with an Initialize button
- An empty Stalled section (the 2 tracked projects are recent)

### v0 Scenario 2 — Initialize a Discovered project

**Given** the dashboard is showing 1 Discovered row
**When** the user clicks Initialize on that row
**Then** the server writes `.factory/config.yaml`, `.factory/status.json`, `.factory/context.md`, and `.factory/CLAUDE.md` to that directory. Within 1 second of the RPC returning, the dashboard re-scans and the project has moved from Discovered to Tracked. The default config has phase `IDEA`, trust tier `2`, and a display name matching the directory basename.

### v0 Scenario 3 — Navigate from dashboard to Stand

**Given** the dashboard is showing a Tracked project with no active thread
**When** the user clicks that row
**Then** the app switches to Stand mode (route changes), opens an empty draft chat whose `cwd` is the project's path, and the Factory panel auto-loads for that project. The mode toggle reflects the switch.

### v0 Scenario 4 — Stalled detection

**Given** a Tracked project whose `.factory/status.json#last_activity` is dated > 7 days ago (or is missing a value and `gapCount > 0`)
**When** the dashboard renders
**Then** the project appears in both the Tracked section (normal row) and the Stalled section (with a visual emphasis). Client-side only; the stalled flag is not persisted. A missing or unparseable `last_activity` by itself is not stalled — we only know the project is stalled when we can actually measure the age.

### v0 Scenario 5 — Attribution banner for non-owner

**Given** a Tracked project with `assigned_dev: "alice"` and `attacca.user: "bob"` in client settings
**When** the user opens that project in Stand mode (from Podium or directly)
**Then** a one-line banner at the top of the Factory panel reads "**Owned by @alice**" (neutral attribution, not "guest"). The user can still use every Factory panel feature. The banner is dismissible per-session, not per-project.

### v0 Scenario 6 — No banner for owner or blank identity

**Given** a Tracked project with `assigned_dev: "alice"`
**When** the user opens that project in Stand mode and either (a) `attacca.user === "alice"` or (b) `attacca.user` is blank
**Then** no attribution banner renders. Case (a) because you *are* the owner; case (b) because we can't compare identities.

### v0 Scenario 7 — Scanner handles missing root

**Given** the configured `ATTACCA_PODIUM_ROOT` points to a directory that doesn't exist
**When** the user opens Podium
**Then** the dashboard renders an empty state: "No projects found at `<path>`. Check your scan root in settings." No error modal, no thrown exception, no broken layout.

### v0 Scenario 8 — Identity bootstrap on first launch

**Given** a fresh install with no `attacca.user` in client settings and a machine where `git config --global user.name` returns `"bob"`
**When** the user launches Attacca for the first time
**Then** `attacca.user` is set to `"bob"` via the `factory.getGitIdentity` server RPC, persisted to settings, and used for all downstream reads. On subsequent launches, the value is loaded from settings without re-querying git. If the user later edits `attacca.user` in the settings UI, that value takes precedence forever.

### v0 Scenario 9 — Protocol version guard (forward compat)

**Given** a project whose `.factory/config.yaml` contains `version: 99`
**When** the user opens it in Stand mode or the scanner hits it
**Then** the reader throws `FactoryProtocolVersionError` with a typed payload. The Factory panel (or dashboard row) renders an error state with the human-readable message: "This project uses .factory/ protocol v99 but this Attacca client supports up to v1. Update Attacca or downgrade the project." No other parts of the UI crash.

### v0 Scenario 10 — Protocol version guard (backward compat)

**Given** a project whose `.factory/config.yaml` omits the `version` field entirely (legacy config from Phase 1)
**When** the user opens it
**Then** the reader treats it as `version: 1` and loads normally. No error, no warning. The writer upgrades the file to `version: 1` on the next write.

## Resolved decisions

The four open questions from the initial draft were resolved before locking this spec. Decisions recorded here so future readers can see *why* not just *what*.

1. **`assigned_dev` stays as a single optional string** interpreted as the accountable owner. The UX fix for team projects is framing, not schema: the banner says "Owned by @{dev}" (neutral attribution), not "Viewing as guest" (accusatory). Team collaborators see an accurate banner when contributing to someone else's project; the owner never sees it. If a real multi-user membership concept is needed, it lands as a separate `contributors: string[]` field — never a widening of `assigned_dev`.

2. **Identity is client-settings first, git as bootstrap only.** `attacca.user` in client settings is the single source of truth. Git is read once on first launch via a new `factory.getGitIdentity` server RPC, stored in settings, and never re-read. The settings UI lets users override it. This fixes the fork/worktree/multi-email problems in one stroke and matches the Option A philosophy (local-first, user-overridable, no server auth). It also retroactively replaces the `dev="developer"` hardcoding from Phase 1 task #6.

3. **Discovered filter is deferred.** The existing `EXCLUDE` set plus a new `ATTACCA_PODIUM_EXCLUDE` comma-separated env var is the only filter control in v0. A real user-facing dismiss/ignore mechanism is hypothetical until we actually test against a noisy project root. If v0 testing shows the Discovered section is painful, a per-project Dismiss button writing to a `dismissedPaths: string[]` settings field is a fast v0.5 follow-up. Don't spec the filter mechanism before seeing the noise.

4. **Protocol versioning promoted to v0 scope.** `FactoryConfig.version: number` is added now, with `FACTORY_PROTOCOL_VERSION = 1` exported from contracts. The reader treats missing version as 1 (backward compat with Phase 1 files) and throws `FactoryProtocolVersionError` for anything greater than the current supported version. This is cheap insurance — maybe 20 lines of code — and it unblocks a clean migration path for the inevitable v1 → v2. Crucially, this is **`.factory/` protocol version, not `attacca-forge` package version** — they version independently. The forge package is skills, the protocol is file layout.

## Dependencies on Phase 1 (shipped)

- `factory.read`, `factory.readSummary`, `factory.initialize` RPCs — all shipped (`c14d41db`).
- `ScannedProject` type — already exists in `apps/server/src/scanner/index.ts` but not yet in contracts. v0 task #1 moves it to contracts.
- Factory store — stays as-is. Podium store is separate.
- Factory panel — stays as-is structurally. The "Owned by @{dev}" attribution banner is a v0 addition, and the panel will read from `attacca.user` instead of a hardcoded identity.
- Session log writer — v0 task #7 retroactively replaces the `dev="developer"` hardcoding from Phase 1 task #6 with a read from `attacca.user`.

## Phase 2.5 preview (out of scope for v0)

The things explicitly deferred:

- **Gap analysis engine** — heuristic pattern matching that compares `.factory/spec.md` to the code tree and the test tree, producing a real `gapCount` and a list of gap objects (missing test coverage for a spec section, orphaned test without spec, stale spec reference to removed code). Probably wants its own spec, likely co-specced with the Forge `harness-simulator` skill.
- **Work package generator** — given a list of gaps, produce work items and write them to `.factory/queue.json`. Requires the gap analysis to exist first.
- **External intake flow** — the flavor 3 spec: "take a directory or GitHub URL that isn't under my project root, clone/move/link it, run a Forge skill (likely `spec-writer` or `codebase-discovery` depending on greenfield vs brownfield), initialize, done." Bigger sprint because it touches git, cloning, directory layout, and Forge skill invocation from the server side.
- **Multi-root scan** — `rootDirs: string[]` in settings, UI to add/remove, dedup across roots.
- **Discovered-project Dismiss pattern** — per-project Dismiss button writing to a `dismissedPaths: string[]` settings field with a "Show dismissed (N)" toggle. Only ship if v0 testing shows the Discovered section is actually noisy.
- **`contributors: string[]` field** — only if real multi-user membership becomes a concrete need distinct from ownership.

## Build order

v0 tasks should ship in this order because later items depend on earlier ones:

1. **Protocol version + contracts updates** (task #8) — touches `FactoryConfig` schema. Everything downstream reads this, so it's first. Includes `ScannedProject` + `FactoryProtocolVersionError` in contracts.
2. **Identity RPC + settings** (task #7) — `factory.getGitIdentity` server RPC + `attacca.user` client setting + retroactive wiring through Phase 1 session logs and Factory panel. Unblocks the banner in task #3.
3. **Scanner RPC** (task #1) — expose `factory.scanProjects` with `ATTACCA_PODIUM_EXCLUDE` support. Server + contracts + WS client.
4. **Podium store** (task #2) — Zustand store wiring the scanner RPC.
5. **Dashboard route + sections** (task #3) — `/podium` route, Tracked/Discovered/Stalled rendering, row interactions, Initialize button, attribution banner reads.
6. **Mode switching** (task #4) — Sidebar toggle, `defaultMode` setting (task #6), routing glue.
7. **Intake flow** (task #5) — Initialize button already works from task #3; this step is validating end-to-end: click Initialize, scan refreshes, project moves to Tracked.

Each step should typecheck cleanly before moving to the next.

## Review checklist

Before I start building v0, confirm:

- [ ] Mode enforcement Option A is the right call.
- [ ] Eight-item v0 scope (scanner + store + dashboard + mode switcher + Initialize intake + `defaultMode` + `attacca.user` identity + protocol versioning) is the right shape.
- [ ] Deferrals (gap analysis, work dispatch, external intake, Discovered Dismiss pattern, `contributors`) are acceptable.
- [ ] `C:\Users\jhon1\projects\` is the right hardcoded default scan root, and `ATTACCA_PODIUM_ROOT` / `ATTACCA_PODIUM_EXCLUDE` are the right env var names.
- [ ] Routing choice: `_chat.podium.tsx` (under the chat layout) vs a sibling route (`podium.tsx`). I'm recommending under-layout so the sidebar stays visible.
- [ ] The Stalled threshold of 7 days is the right number.
- [ ] Build order above is the right sequence.
