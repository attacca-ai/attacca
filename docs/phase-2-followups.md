# Phase 2 follow-ups

**Status**: Groups A + B fully shipped. Group C: C1, C2, C4, C5, C7 shipped; C3, C6, and C8–C10 deferred to Phase 2.5.
**Scope**: issues surfaced during `coderabbit:code-reviewer` review of commits `b96308fc..a883d92f`. Hotfixes (Group A) landed in `6486eed6..5a652278`. Group B landed in `ba31a30f..4c737cf3`. Group C pre-Phase-3 items landed in `3c5f0d79..8b3c794d`.
**Relates to**: `docs/phase-2-podium-spec.md`, `docs/factory-protocol.md`.

---

## Group B — shipped (`ba31a30f..4c737cf3`)

All five items landed. Summaries retained below for history.

### B1. Reconcile "stalled" source of truth between spec and code — ✅ shipped (`ba31a30f`)

**What**: The Phase 2 spec, scenario 4, says "Given a Tracked project whose _most recent session log_ is dated > 7 days ago". The implementation in `apps/web/src/stores/podium.ts#selectStalledProjects` actually uses `ScannedProject.lastActivity`, which is sourced from `status.json#last_activity` by the server scanner — not from session log file mtimes. Those two can diverge.

**Decision**: keep the `status.last_activity` approach (it's cheaper — one read per project instead of globbing session logs), and update the spec text to match.

**Action**: edit `docs/phase-2-podium-spec.md` scenario 4 to say "whose `.factory/status.json#last_activity` is dated > 7 days ago".

**Why it's not a hotfix**: no behavior change, just a doc correction.

### B2. Surface initialize errors on Discovered rows — ✅ shipped (`f5ed5f62`)

**What**: `apps/web/src/routes/_chat.podium.tsx#handleInitialize` awaits `initializeFactory(...)` and clears the spinner, then calls `refresh()` regardless of whether the init actually succeeded. `initializeFactory` in `apps/web/src/stores/factory.ts` swallows errors and returns `null`. A user clicking Initialize on a permission-denied directory (or any other failure) sees the spinner disappear and nothing change, with no feedback.

**Action**: either (a) change `initializeFactory` to return a discriminated union `{ ok: true, directory } | { ok: false, error: string }`, or (b) add a toast via the existing `toastManager` pattern (see `apps/web/src/components/ui/toast.tsx`). (b) is cheaper and matches how the rest of the app surfaces async failures.

**Why it's not a hotfix**: the UX is bad but not _data-loss_ bad, and there's no easy smoke test for the toast path without a browser.

### B3. Scanner permission-denied falls through to error modal — ✅ shipped (`6983adbe`)

**What**: `apps/server/src/scanner/index.ts#scanProjects` checks `existsSync(rootDir)` and returns `[]` when the directory doesn't exist (matching spec scenario 7 — missing root renders empty state). But if the directory exists and `readdirSync(rootDir)` throws `EACCES` (Windows permission-denied, locked folder, etc.), the error propagates up to `scanProjectsEffect` and becomes a `FactoryReadError`, which the dashboard renders as a red error card instead of the calm empty state.

**Action**: wrap `readdirSync` in try/catch inside `scanProjects` and return `[]` on any read error (the scanner's contract is "return what you can scan"). Alternatively, log the error server-side and still return `[]`.

**Why it's not a hotfix**: rare in practice, and the error card isn't _wrong_ — it's just less graceful than the empty state. Worth fixing but not urgent.

### B4. Identity bootstrap cross-tab race — ✅ shipped (`ad3f1d77`)

**What**: `apps/web/src/hooks/useSettings.ts#bootstrapAttaccaUserIfMissing` does read-RPC-write on localStorage. If another tab writes `attaccaUser` between the read and the write, we clobber their change. Near-impossible in practice (user has to cold-open two tabs _and_ change identity in one before the other's bootstrap completes), but trivial to fix.

**Action**: re-read localStorage immediately before the write, inside the same try, and only write if `attaccaUser` is still empty. Three lines.

### B5. `useShallow` on podium selectors for render perf — ✅ shipped (`4c737cf3`)

**What**: `apps/web/src/stores/podium.ts` exports `selectTrackedProjects`, `selectDiscoveredProjects`, `selectStalledProjects`. Each creates a fresh array via `[...state.projects].filter(...)`. The dashboard uses them as `usePodiumStore(selectTrackedProjects)`, which means any unrelated store write triggers a re-render because the array reference changes. Not a correctness issue — just unnecessary rerenders.

**Action**: either wrap the selectors in `useShallow` at call sites (`usePodiumStore(useShallow(selectTrackedProjects))`), or move them to memoized derivations.

**Why it's not a hotfix**: v0 scan result is small (21 projects on the real root); rerender cost is negligible.

## Group C — deferred to Phase 2.5 (design or larger scope)

### C1. Draft chat in project `cwd` on Podium row click (spec scenario 3 gap) — ✅ shipped (`3c5f0d79`)

**What**: Phase 2 spec scenario 3 says "clicking a Tracked row navigates to Stand mode [...] opens an empty draft chat whose `cwd` is the project's path". The current implementation in `apps/web/src/routes/_chat.podium.tsx#handleOpenProject` navigates to `/` and expands the matching project in the sidebar _if_ a matching orchestration project exists — but it does not open a draft chat. **Spec violation, medium severity.**

**Why deferred**: the draft-chat flow lives inside `useHandleNewThread` (`apps/web/src/hooks/useHandleNewThread.ts`), which expects a registered orchestration project, a scoped project ref, and defaults for runtime/interaction mode. Wiring the Podium row click into that flow requires handling the case where the clicked project doesn't exist in the orchestration registry yet (a Podium-discovered `.factory/` that was never added as an Attacca project). That's a new subflow: "register this project, then open a thread", which is a real feature, not a one-line fix.

**Proposed design for 2.5**:

1. If the matched project is already in the orchestration registry → navigate to `/` and use `handleNewThread` with the existing project ref.
2. If not → call a new `projects.addFromPath` RPC first (or piggyback on `projects.create` if it exists), wait for the event to land in the read model, then `handleNewThread`.
3. Add a loading state on the Podium row so the user sees "Opening..." instead of a silent pause.

### C2. Defense-in-depth path validation on write RPCs — ✅ shipped (`bb1b3041`)

**What**: `factory.initialize`, `factory.writeQueue`, `factory.writeSessionLog`, and `factory.regenerateClaudeMd` all accept an arbitrary absolute `projectPath` and write files there. The Phase 2 spec explicitly accepts "no auth" as the local-first model, but defense-in-depth says the writer RPCs should still refuse paths outside the configured scan root.

**Action**: inside `scanProjectsEffect`'s siblings in `FactoryRpc.ts`, validate that `projectPath` is a subpath of the resolved podium root (or an explicit allow-list for testing). Reject with a new `FactoryPathError` tagged error if not.

**Why deferred**: needs the path-containment check to handle Windows case-insensitivity, forward/back-slash normalization, and `..` resolution. Not hard, but worth doing in one coherent PR with tests.

### C3. External intake flow (flavor 3 from the Phase 2 spec)

**What**: Spec defers this — "take a directory or GitHub URL that isn't under my project root, clone it, run a Forge skill to generate a spec, initialize". Clone + skill-invocation + registration is its own sprint.

### C4. Gap analysis engine + work package dispatch — ✅ shipped (`55fcead8`)

**What**: Gap analysis and work-package dispatch landed on `feature/gap-dispatch`. Podium now scans `.factory/` protocol gaps server-side, surfaces them inline on tracked rows, and dispatches per-gap queue items via `factory.dispatchWorkPackage`.

### C5. Multi-root scanning (`rootDirs: string[]`) — ✅ shipped (`55fcead8`)

**What**: Podium now scans the primary root plus `externalIntakeRoots`, merges results client-side with normalized-path deduplication, and renders one unified list.

### C6. Discovered-project Dismiss pattern

**What**: Spec defers this. Real need is unclear until v0 is tested against noisy roots — the existing `EXCLUDE` + `ATTACCA_PODIUM_EXCLUDE` may already be enough.

### C7. Settings UI for `defaultMode`, `attaccaUser`, scan root override — ✅ shipped (`8b3c794d`)

**What**: Settings schema fields exist but no edit surface. Needed for the `defaultMode` setting to actually influence startup routing, for users to override `attaccaUser` after bootstrap, and for scan root override without editing env vars.

### C8. Scanner pagination / virtualization

**What**: The Discovered section renders all rows inline. At 20 rows it's fine; at 200+ it'll be janky. Add `react-virtuoso` or similar, or a "show all (N)" toggle.

### C9. Real YAML library for `.factory/config.yaml`

**What**: The minimal YAML parser in `apps/server/src/factory/reader.ts` doesn't handle nested objects, multi-line scalars beyond what we emit, or anchors. The writer matches — both are lossy for any future nested config section. When the protocol grows its first nested field, swap to `js-yaml` or `yaml` on both sides.

### C10. `FactoryConfig.version` as non-optional in-memory

**What**: The schema has `version: Schema.optional(Schema.Number)` because legacy configs don't have it, but the reader always normalizes missing values to 1 before returning, so every in-memory `FactoryConfig` actually has a version. The type should reflect this. Either split into `FactoryConfigOnDisk` (optional version) and `FactoryConfig` (required version), or accept the mild inconsistency.

## Triage recommendation (final)

**Groups A, B, and the "do before Phase 3" slice of C (C1, C2, C7) all shipped.** Phase 2 is done — what remains is Phase 2.5 scope that wants its own design.

**Phase 2.5 sprint candidates**: C3 (external intake flow — clone/move a project from a URL or external path, run a Forge skill to generate a spec), C6 (Discovered Dismiss UI — only if testing shows the scanner output is actually noisy). These each want their own spec doc following the `phase-2-podium-spec.md` pattern.

**Nice-to-have, touch when convenient**: C8 (scanner pagination / virtualization), C9 (real YAML library), C10 (non-optional in-memory `version`) — none are user-visible failures, all trivial when touched.
