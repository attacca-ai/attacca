# Phase 2 follow-ups

**Status**: Groups A + B fully shipped. Group C is fully shipped. C9 and C10 are already satisfied in code.
**Scope**: issues surfaced during `coderabbit:code-reviewer` review of commits `b96308fc..a883d92f`. Hotfixes (Group A) landed in `6486eed6..5a652278`. Group B landed in `ba31a30f..4c737cf3`. Group C pre-Phase-3 items landed in `3c5f0d79..8b3c794d`.
**Relates to**: `docs/phase-2-podium-spec.md`, `docs/factory-protocol.md`.

## Status update - 2026-04-21

- C3 is now fully shipped: Podium can intake an existing local directory or a Git URL, persist intake roots, initialize `.factory/` safely, auto-detect brownfield vs greenfield during init, open a draft thread in that project, and seed the draft with the right Forge handoff prompt.
- Group C status is now fully shipped. C9/C10 no longer need follow-up work.

---

## Group B - shipped (`ba31a30f..4c737cf3`)

All five items landed. Summaries retained below for history.

### B1. Reconcile "stalled" source of truth between spec and code - shipped (`ba31a30f`)

**What**: The Phase 2 spec, scenario 4, said "Given a Tracked project whose most recent session log is dated > 7 days ago". The implementation in `apps/web/src/stores/podium.ts#selectStalledProjects` actually uses `ScannedProject.lastActivity`, which is sourced from `status.json#last_activity` by the server scanner - not from session log file mtimes.

**Decision**: keep the `status.last_activity` approach and update the spec text to match.

### B2. Surface initialize errors on Discovered rows - shipped (`f5ed5f62`)

**What**: Podium initialize failures were previously silent. The UI now surfaces the error instead of dropping the spinner and pretending nothing happened.

### B3. Scanner permission-denied falls through to error modal - shipped (`6983adbe`)

**What**: Scanner read failures on an existing root now degrade gracefully instead of bubbling into a red dashboard error card for common permission-denied cases.

### B4. Identity bootstrap cross-tab race - shipped (`ad3f1d77`)

**What**: `attaccaUser` bootstrap now re-checks storage before writing so another tab cannot be trivially clobbered during startup.

### B5. `useShallow` on podium selectors for render perf - shipped (`4c737cf3`)

**What**: Podium selector subscriptions now avoid unnecessary rerenders caused by fresh array identities on unrelated store writes.

## Group C - Phase 2.5 / larger follow-ups

### C1. Draft chat in project `cwd` on Podium row click - shipped (`3c5f0d79`)

Podium row click now opens or creates a draft thread in the matched project instead of only navigating and expanding sidebar state.

### C2. Defense-in-depth path validation on write RPCs - shipped (`bb1b3041`)

Factory write RPCs now validate target paths against the Podium root plus explicit intake roots instead of accepting arbitrary absolute paths.

### C3. External intake flow - shipped

**What shipped**:

- Intake existing local directories via picker or pasted path.
- Clone a Git URL into the active Podium root, then reuse the same intake pipeline.
- Persist intake roots with explicit consent.
- Dispatch `project.create`, initialize `.factory/`, and open a draft thread.
- Keep `initializeFactory` idempotent so an existing `.factory/` is not clobbered.
- Auto-detect brownfield vs greenfield during init from project markers.
- Seed the opened draft with a Forge handoff prompt: `spec-writer` for greenfield, `codebase-discovery` for brownfield.
- Reuse an existing registered project ref during intake, but still initialize `.factory/` when that project was added earlier without Factory metadata.

### C4. Gap analysis engine + work package dispatch - shipped (`55fcead8`)

Podium scans `.factory/` protocol gaps server-side, renders them inline on tracked rows, and dispatches per-gap queue items via `factory.dispatchWorkPackage`.

### C5. Multi-root scanning - shipped (`55fcead8`)

Podium scans the primary root plus `externalIntakeRoots`, merges results with normalized-path deduplication, and renders one unified list.

### C6. Discovered-project Dismiss pattern - shipped

**What shipped**:

- Podium discovered rows now support a persisted `Dismiss` action.
- Dismissed paths live in client settings and are hidden by default from the Discovered section.
- Podium renders a `Show dismissed (N)` toggle so dismissed entries can be reviewed and restored.
- Stand settings now includes a section for clearing dismissed discovered paths directly.

### C7. Settings UI for `defaultMode`, `attaccaUser`, scan root override - shipped (`8b3c794d`)

The settings surface for these fields is implemented.

### C8. Scanner pagination / virtualization - shipped as preview cap + "Show all"

**What shipped**:

- Podium no longer renders arbitrarily large discovered lists in full by default.
- The Discovered section shows a capped preview for long lists with an explicit `Show all (N)` control.
- The same preview behavior applies to the optional dismissed-projects view.

**Note**: this ships the lighter-weight branch of C8 from the follow-up doc. Full row virtualization is still unnecessary unless Podium grows beyond what the current preview cap handles comfortably.

### C9. Real YAML library for `.factory/config.yaml` - already satisfied

The reader and writer already use the `yaml` package, so this follow-up is stale.

### C10. `FactoryConfig.version` as non-optional in-memory - already satisfied

`FactoryConfig.version` is already part of the shared schema and decodes with a default of `FACTORY_PROTOCOL_VERSION`, while the reader preserves backward compatibility for legacy on-disk configs that omitted it.

## Triage recommendation

**Phase 2 shipped scope**: C1-C8 are done.
