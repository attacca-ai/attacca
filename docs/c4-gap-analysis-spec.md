# C4 — Gap analysis engine + work package dispatch (spec v0)

**Status**: draft for review
**Date**: 2026-04-11
**Supersedes**: the C4 line item in `docs/phase-2-followups.md`.
**Relates to**: `docs/phase-2-podium-spec.md`, `docs/factory-protocol.md`, `packages/contracts/src/factory.ts`, `attacca-forge:harness-simulator` skill.

---

## Purpose

Podium v0 shows a `gapCount` badge on each tracked project, but the number comes directly from `status.json#gap_count` — a static field that nothing writes to automatically. The badge is decorative. There is no system that inspects a project's `.factory/` directory, compares what's there against what *should* be there for the project's current phase and trust tier, and produces a structured list of gaps. There is also no mechanism to turn a gap into actionable work — the user sees "3 gaps" but has no way to ask "which 3?" or "fix them."

C4 closes both halves:

1. **Gap analysis engine** — a server-side function that reads a project's `.factory/` directory and filesystem, evaluates it against the factory protocol requirements for its phase and trust tier, and returns a typed list of gaps.
2. **Work package dispatch** — given a gap (or a set of gaps), produce a structured work package and either write it to `.factory/queue.json` or open a draft Stand thread with a preset prompt that addresses the gap.

Together these turn the Podium dashboard from a passive inventory into an active dispatch surface: the operator sees what's wrong, clicks a button, and the right work gets queued or started.

## Resolved design decisions

### D1. What constitutes a "gap"

A gap is a specific, testable deficiency in a project's `.factory/` state relative to what the factory protocol requires for the project's declared `phase` and `trust_tier`. Gaps are not opinions or suggestions — they are protocol violations or missing prerequisites.

v0 gap categories (in priority order):

| ID | Category | Condition | Applies when |
|----|----------|-----------|-------------|
| G1 | `missing_config` | `.factory/config.yaml` does not exist or fails to parse | Always |
| G2 | `missing_status` | `.factory/status.json` does not exist or fails to parse | Always |
| G3 | `missing_spec` | `.factory/spec.md` does not exist or is empty | Phase >= SPEC |
| G4 | `missing_context` | `.factory/context.md` does not exist or is empty | Always |
| G5 | `empty_queue` | `.factory/queue.json` does not exist or has zero pending items | Phase >= BUILD |
| G6 | `no_session_logs` | `.factory/progress/` has zero session log files | Phase >= BUILD |
| G7 | `stale_activity` | `status.json#last_activity` is older than 7 days | Phase is BUILD, TEST, or DEPLOY |
| G8 | `missing_intent_contract` | `.factory/intent-contract.md` does not exist | trust_tier >= 3 |
| G9 | `missing_scenarios` | `.factory/scenarios.md` does not exist or is empty | Phase >= SPEC and trust_tier >= 2 |
| G10 | `incomplete_config` | `config.yaml` is missing `assigned_dev`, `stack`, or `repo` for a project in BUILD+ phase | Phase >= BUILD |

**Why these and not more**: each gap maps to a concrete, observable filesystem condition. No heuristic code analysis, no LLM calls, no test-coverage parsing. Those are v1 territory. v0 gaps are cheap to compute (filesystem existence checks + JSON/YAML field reads) and unambiguous to resolve.

**Why phase/tier gating**: requiring a spec for an IDEA-phase project is noise. The gap engine respects the project's declared lifecycle position — gaps are things that are *overdue*, not things that are *eventually needed*.

### D2. Where gap analysis runs: server-side, on scan

The gap analysis engine is a pure function that runs **server-side as part of the scan**. When `scanProjects` processes a directory with `.factory/`, it calls the gap analyzer after reading the config and status. The result is returned as part of `ScannedProject`.

**Why not client-side**: the gap checks need filesystem access (does `spec.md` exist? is `progress/` empty?). The server already reads the filesystem during scan. Running gap analysis client-side would require new RPCs per project for each file existence check.

**Why not a separate RPC**: keeping it in the scan path means every Podium refresh gets fresh gap data with zero additional round-trips. A separate RPC would require the client to call it per-project or in batch, adding latency and complexity. If gap analysis becomes expensive in v1 (e.g., code analysis), we can split it out then.

**Why not background/continuous**: scans are user-triggered (Refresh button or Podium route load). No background polling, no file watchers. Same model as the existing scanner. The gap data is as fresh as the last scan.

### D3. What is a "work package"

A work package is a `WorkItem` (already defined in `packages/contracts/src/factory.ts`) with fields populated from a gap. The gap analyzer produces the gap; the dispatch step converts it into a work item and writes it to `queue.json`.

Mapping from gap to work item:

| Gap | WorkItem type | WorkItem title pattern | Suggested skill |
|-----|---------------|----------------------|-----------------|
| G1 | `spec_gap` | "Initialize .factory/config.yaml" | — (manual or re-init) |
| G2 | `spec_gap` | "Create .factory/status.json" | — |
| G3 | `spec_gap` | "Write project specification" | `attacca-forge:spec-writer` |
| G4 | `spec_gap` | "Write project context document" | `attacca-forge:codebase-discovery` |
| G5 | `enhancement` | "Populate work queue" | `attacca-forge:build-orchestrator` |
| G6 | `enhancement` | "Start first work session" | — |
| G7 | `enhancement` | "Resume stalled project" | — |
| G8 | `spec_gap` | "Write intent contract" | `attacca-forge:intent-spec` |
| G9 | `spec_gap` | "Write behavioral scenarios" | `attacca-forge:spec-architect` |
| G10 | `enhancement` | "Complete project configuration" | — |

The `description` field on each work item includes the specific gap detail (e.g., "spec.md does not exist; this project is in SPEC phase and requires a specification"). The `spec_section` field is left null for v0 — it becomes meaningful when gap analysis can reference specific spec sections in v1.

**Why reuse WorkItem**: the schema already exists, the queue reader/writer already exists, and Stand already displays queue items. No new types needed.

### D4. How dispatch works: queue write + optional draft thread

Dispatch has two modes, selectable per-action in the Podium UI:

1. **Queue only** (default) — write the work item to `.factory/queue.json`. The item appears in the project's Stand queue panel. The assigned dev picks it up in their next session.
2. **Queue + open thread** — write the work item to the queue *and* open a draft Stand thread with a preset prompt that addresses the gap. The preset prompt includes the gap description and, if a Forge skill is suggested, a `/skill-name` invocation.

**Why queue-first**: dispatch should be a planning action, not an interruption. The operator triages gaps in Podium, queues work, and the developer processes the queue in Stand. Opening a thread is opt-in for when the operator wants to immediately start working on the gap themselves.

**Why not just open a thread**: threads without queue entries are invisible to Podium. The queue is the coordination artifact — it's how Podium knows work was dispatched and how Stand knows what to work on.

### D5. How results surface in the Podium UI

Two changes to the existing dashboard:

1. **Gap badge becomes expandable** — clicking the "N gaps" badge on a tracked project row expands an inline gap list below the row. Each gap shows its category, a human-readable description, and a "Dispatch" button.
2. **No separate gaps view** — gaps are per-project, displayed inline. A global "all gaps across all projects" view is v1. For v0, the "Needs attention" section already filters to projects with `gapCount > 0`, which is sufficient for triage.

**Why inline, not a modal or detail page**: the operator's workflow is scan-triage-dispatch. Inline expansion keeps all three steps on one screen. A modal interrupts scanning; a detail page loses the cross-project overview.

### D6. Gap data shape in ScannedProject

The existing `ScannedProject` has a `gapCount: number` field. v0 extends this with a `gaps: Gap[]` field that carries the structured gap data. `gapCount` becomes a derived value (`gaps.length`) for backward compat.

The `Gap` type:

```typescript
const GapCategory = Schema.Literals([
  "missing_config",
  "missing_status",
  "missing_spec",
  "missing_context",
  "empty_queue",
  "no_session_logs",
  "stale_activity",
  "missing_intent_contract",
  "missing_scenarios",
  "incomplete_config",
]);

const Gap = Schema.Struct({
  category: GapCategory,
  severity: Schema.Literals(["high", "medium", "low"]),
  message: Schema.String,
  suggestedSkill: Schema.optional(Schema.String),
});
```

Severity rules:
- **high**: G1 (missing config), G2 (missing status) — the project is unreadable without these
- **medium**: G3 (missing spec in SPEC+ phase), G8 (missing intent contract at tier 3+), G9 (missing scenarios)
- **low**: G4, G5, G6, G7, G10 — important but not blocking

### D7. Relationship to attacca-forge skills

The gap analyzer *suggests* skills but does not *invoke* them. The `suggestedSkill` field on a `Gap` is a hint that the dispatch UI uses to compose the preset prompt for the draft thread. The user (or agent) decides whether to actually run the skill.

**Why not auto-invoke**: skill invocation from the server side is not built yet (deferred in C3.6). Even when it is, auto-running a skill that generates a spec or rewrites context.md should require explicit user consent. The gap engine is a diagnostic, not an executor.

## v0 scope

Six implementation tasks, in build order:

1. **Contracts: `Gap` type + `ScannedProject` extension** — add `GapCategory`, `Gap` schema to `packages/contracts/src/factory.ts`. Add `gaps: Schema.Array(Gap)` to `ScannedProject`. Keep `gapCount` as a field (populated from `gaps.length` by the scanner) for backward compat with any code that reads it directly.

2. **Server: gap analyzer function** — new file `apps/server/src/scanner/gaps.ts`. Export `analyzeGaps(projectPath: string, config: FactoryConfig | null, status: FactoryStatus | null): Gap[]`. Pure function: reads filesystem for existence checks, evaluates phase/tier rules, returns gaps. Unit-testable without mocking the scanner.

3. **Server: integrate gap analyzer into scanner** — in `apps/server/src/scanner/index.ts`, call `analyzeGaps` inside `fromFactory` and populate the `gaps` field on the returned `ScannedProject`. Set `gapCount` to `gaps.length`. Remove the old `gapCount: status?.gap_count ?? 0` read — the analyzer is now the source of truth.

4. **Server: dispatch RPC** — new RPC `factory.dispatchWorkPackage` that accepts `{ projectPath: string, gap: Gap, allowedRoots?: string[] }`, converts the gap into a `WorkItem`, reads the current `queue.json` (or creates one), appends the item, and writes it back. Returns the created `WorkItem` with its generated `id`.

5. **Client: gap list expansion in Podium rows** — modify `TrackedRow` in `_chat.podium.tsx` to support an expanded state. When the user clicks the gap badge, render the gap list below the row with category, severity badge, message, and a "Dispatch" button per gap. The "Dispatch" button calls `factory.dispatchWorkPackage` and shows a success toast. Add a "Dispatch + Open" variant that also calls `handleOpenProject` after dispatch.

6. **Client: podium store gap-aware selectors** — update `selectStalledProjects` to use `p.gaps.length > 0` instead of `p.gapCount > 0` (should be equivalent, but makes the data flow explicit). Add a `selectProjectsByGapSeverity` selector that sorts projects by their highest-severity gap for a potential future "worst first" sort.

## v0 non-behaviors

Explicitly not building:

- **Code analysis gaps**. No parsing of source files, test files, or import graphs. Gaps are `.factory/` protocol compliance checks only.
- **LLM-powered gap detection**. No calling an LLM to evaluate whether a spec is "good enough" or a context doc is "complete." The checks are deterministic filesystem predicates.
- **Sync-status integration**. The `.factory/sync-status.json` file tracks spec-tests-code triangle state, which is rich gap data. Integrating it requires the sync-status to actually be populated (it's currently written by Forge skills, not by the scanner). Deferred to v1.
- **Auto-dispatch**. No automatic creation of work items from gaps. All dispatch is user-initiated via the Podium UI.
- **Batch dispatch**. No "dispatch all gaps for this project" or "dispatch all gaps across all projects" button. One gap at a time in v0. Batch is a fast follow-up if single dispatch proves tedious.
- **Gap history or trends**. No tracking of gap counts over time. No "this project had 5 gaps last week, now has 3" reporting.
- **Global gaps view**. No cross-project gap aggregation page. The "Needs attention" section in Podium serves this role approximately. A dedicated view is v1.
- **Skill auto-invocation from dispatch**. The dispatch flow writes a queue entry and optionally opens a thread with a preset prompt. It does not execute Forge skills server-side.
- **Custom gap rules**. The gap categories are hardcoded. No user-defined gap rules or per-project overrides.

## Integration boundaries

- **Scanner** (`apps/server/src/scanner/index.ts`): the `fromFactory` function gains a call to `analyzeGaps`. The return type `ScannedProject` gains a `gaps` field. The `gapCount` field changes from reading `status.gap_count` to `gaps.length`.
- **Contracts** (`packages/contracts/src/factory.ts`): new `GapCategory`, `Gap` schemas. `ScannedProject` extended with `gaps: Schema.Array(Gap)`.
- **Factory reader** (`apps/server/src/factory/`): gap analyzer imports `hasFactoryDir`, `readFactorySummary` helpers. May also need raw `existsSync` checks for files the reader doesn't currently surface (e.g., `spec.md`, `scenarios.md`, `intent-contract.md`, `progress/` directory).
- **Queue writer** (`apps/server/src/factory/`): the dispatch RPC reuses the existing `writeQueue` logic. If no `queue.json` exists, creates one with the standard header fields (`version: 1`, `generated`, `generated_by: "podium-dispatch"`).
- **Podium dashboard** (`apps/web/src/routes/_chat.podium.tsx`): `TrackedRow` component gains expandable gap list. `ProjectBadges` gap badge becomes clickable.
- **Podium store** (`apps/web/src/stores/podium.ts`): selectors updated to use `gaps` array instead of `gapCount` scalar.
- **Path validation**: the dispatch RPC respects the existing `assertPathInsideAllowedRoot` check — it writes to `.factory/queue.json` which is inside the project directory.

## Behavioral scenarios

### v0 Scenario 1 — Gap analysis on scan shows missing spec

**Given** a tracked project at `D:\repos\acme-api` with `.factory/config.yaml` declaring `phase: SPEC`, `trust_tier: 2`, and no `.factory/spec.md` file on disk
**When** the user opens Podium and the scan runs
**Then** the project row shows a "1 gap" badge (amber). Clicking the badge expands the row to show:
- Category: `missing_spec`
- Severity: medium
- Message: "spec.md does not exist. Projects in SPEC phase require a specification."
- Suggested skill: `attacca-forge:spec-writer`
- A "Dispatch" button and a "Dispatch + Open" button.

### v0 Scenario 2 — Gap analysis respects phase gating

**Given** a tracked project with `phase: IDEA` and no `.factory/spec.md`
**When** the scan runs
**Then** no `missing_spec` gap is reported. Specs are not required until SPEC phase. The gap badge either shows "0 gaps" (hidden) or only shows gaps relevant to IDEA phase (e.g., `missing_context` if `context.md` is also absent).

### v0 Scenario 3 — Dispatch writes a work item to queue.json

**Given** a project with a `missing_spec` gap and no existing `queue.json`
**When** the user clicks "Dispatch" on the `missing_spec` gap row in Podium
**Then**:
1. Server creates `.factory/queue.json` with `version: 1`, `generated: <now>`, `generated_by: "podium-dispatch"`.
2. The queue contains one item: `{ id: <uuid>, priority: "medium", title: "Write project specification", description: "spec.md does not exist. Projects in SPEC phase require a specification.", type: "spec_gap", status: "pending" }`.
3. Podium shows a success toast: "Dispatched: Write project specification".
4. On the next scan, the project's `empty_queue` gap (if it was showing) is resolved because the queue now has a pending item.

### v0 Scenario 4 — Dispatch + Open creates a thread with preset prompt

**Given** a project with a `missing_spec` gap
**When** the user clicks "Dispatch + Open" on the gap row
**Then**:
1. The work item is written to `queue.json` (same as scenario 3).
2. A draft Stand thread opens for the project.
3. The thread's composer is pre-filled with: "This project needs a specification. The work queue has a pending item: 'Write project specification'. Consider using `/attacca-forge:spec-writer` to generate one."
4. The user lands in Stand mode with the draft ready to send.

### v0 Scenario 5 — Multiple gaps on one project

**Given** a project in BUILD phase with: no `spec.md`, no session logs in `progress/`, and `config.yaml` missing `assigned_dev`
**When** the scan runs
**Then** the project shows "3 gaps" badge. Expanding shows three gap rows:
1. `missing_spec` (medium) — "spec.md does not exist."
2. `no_session_logs` (low) — "No session logs found in .factory/progress/."
3. `incomplete_config` (low) — "config.yaml is missing assigned_dev for a BUILD-phase project."

Each gap has its own Dispatch button. Dispatching one does not affect the others.

### v0 Scenario 6 — Gap resolves after user action

**Given** a project showed `missing_spec` gap on the last scan. The user then created `.factory/spec.md` with content (via Stand or manually).
**When** the user clicks Refresh in Podium
**Then** the `missing_spec` gap is no longer in the gaps list. The gap badge count decreases by 1. If no gaps remain, the badge is hidden and the project is removed from the "Needs attention" section (unless it's stalled by age).

### v0 Scenario 7 — Dispatch to a project with existing queue items

**Given** a project with an existing `queue.json` containing 2 pending items
**When** the user dispatches a `missing_scenarios` gap
**Then** the new work item is appended to the existing queue (now 3 items). The existing items are not modified. The `generated` timestamp on the queue is updated to reflect the latest write.

### v0 Scenario 8 — Trust tier gating for intent contract

**Given** two projects: Project A with `trust_tier: 2` and Project B with `trust_tier: 3`, both missing `.factory/intent-contract.md`
**When** the scan runs
**Then** Project A shows no `missing_intent_contract` gap (tier 2 does not require intent contracts). Project B shows a `missing_intent_contract` gap (tier 3+ requires one).

### v0 Scenario 9 — Stale activity gap only for active phases

**Given** two projects: Project A in BUILD phase with `last_activity` 10 days ago, and Project B in MAINTAIN phase with `last_activity` 10 days ago
**When** the scan runs
**Then** Project A shows a `stale_activity` gap (BUILD is an active phase where staleness matters). Project B does not show a `stale_activity` gap (MAINTAIN-phase projects are expected to have long idle periods).

### v0 Scenario 10 — Gap analysis on a discovered (non-factory) project

**Given** a directory under the scan root with no `.factory/` directory
**When** the scan runs
**Then** the project appears in the Discovered section with zero gaps. Gap analysis only runs on projects that have `.factory/` — it evaluates protocol compliance, not project potential.

## Open questions (resolve during implementation, not blocking v0 spec)

1. **Preset prompt mechanism for "Dispatch + Open"**: the current `handleNewThread` opens a blank draft. There's no existing mechanism to pre-fill the composer. Options: (a) pass a `presetMessage` option through `handleNewThread` and set it as the initial composer value, (b) write a temporary file that the thread reads on open, (c) use a query parameter on the route. Lean (a) — smallest surface area.

2. **Queue write concurrency**: if two Podium tabs dispatch to the same project simultaneously, the second write could clobber the first. The existing `writeQueue` does a read-then-write without locking. For v0 this is acceptable (single-user local app), but worth noting. A future fix could use `flock` or an atomic rename pattern.

3. **Gap severity tuning**: the severity assignments (high/medium/low) are guesses. They should be validated against real projects during implementation. If `missing_context` turns out to be noisy (most projects don't maintain context.md), it might need to drop to "info" severity or be gated to a higher phase.

4. **`status.json#gap_count` write-back**: should the gap analyzer update `status.json#gap_count` on disk after computing gaps? Pro: other tools that read `status.json` get accurate counts. Con: the scan becomes a write operation, which is surprising and touches path-validation concerns. Lean: no write-back in v0. The scanner returns accurate `gapCount` to the client; `status.json` is not updated automatically.

5. **Gap deduplication with existing queue items**: if a `missing_spec` gap has already been dispatched (there's a "Write project specification" item in the queue), should the gap still show? Lean: yes, the gap persists until the file actually exists. The queue item's existence doesn't resolve the gap — completing the work does. But the UI might want to show "dispatched" state on the gap row. Defer the UX detail to implementation.

## Dependencies

- **Phase 2 Podium** (shipped) — scanner, dashboard, store, `ScannedProject` type.
- **C2 path validation** (shipped, `bb1b3041`) — dispatch RPC needs `assertPathInsideAllowedRoot`.
- **C3 external intake** (in progress) — not a hard dependency, but intake-created projects will immediately benefit from gap analysis on their next scan.
- **`packages/contracts/src/factory.ts`** — `WorkItem`, `WorkQueue`, `FactoryConfig`, `FactoryStatus` schemas are all already defined and sufficient for v0.
- **Queue writer** (`apps/server/src/factory/`) — the existing `writeQueue` server function is reused by the dispatch RPC.

## Out of scope (future work)

- **v1 gap analysis**: code-aware gaps (missing test coverage for spec sections, orphaned tests, stale imports). Requires parsing source files and likely co-specs with `attacca-forge:harness-simulator`.
- **Sync-status integration**: using `.factory/sync-status.json` sections as gap sources. Requires sync-status to be reliably populated.
- **Gap-to-skill auto-execution**: server-side Forge skill invocation triggered by gap dispatch. Blocked on C3.6 (skill invocation from server).
- **Batch dispatch**: "fix all gaps" button that dispatches multiple work items at once.
- **Gap history/trends**: time-series tracking of gap counts per project for progress visualization.
- **Custom gap rules**: user-defined gap categories or per-project overrides of phase/tier gating.
- **Cross-project gap aggregation view**: dedicated page showing all gaps across all projects with filtering and sorting.

## Review checklist

Before I start building v0, confirm:

- [ ] The 10 gap categories (G1-G10) are the right set for v0 — not too many, not missing obvious ones.
- [ ] Phase/tier gating logic is correct (e.g., spec not required until SPEC phase, intent contract only at tier 3+).
- [ ] Gap analysis running inside the scan (not as a separate RPC) is the right architecture for v0.
- [ ] Reusing `WorkItem` for dispatch output (not a new type) is correct.
- [ ] Queue-first dispatch (write to queue.json, optionally open thread) is the right default.
- [ ] Inline gap expansion on the Podium row (not a modal or separate page) is the right UX.
- [ ] No `status.json` write-back from the gap analyzer is the right call for v0.
- [ ] The severity assignments (high for missing config/status, medium for missing spec/intent/scenarios, low for the rest) are reasonable starting points.
- [ ] Build order (contracts -> analyzer -> scanner integration -> dispatch RPC -> UI -> selectors) has no hidden dependencies.
