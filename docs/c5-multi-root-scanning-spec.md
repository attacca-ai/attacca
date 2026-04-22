# C5 — Multi-root scanning (spec v0)

**Status**: implemented on `feature/gap-dispatch`
**Date**: 2026-04-11
**Supersedes**: the C5 line item in `docs/phase-2-followups.md`.
**Relates to**: `docs/c3-external-intake-spec.md`, `docs/phase-2-podium-spec.md`, `docs/factory-protocol.md`.

---

## Purpose

Podium scans a single root directory for projects. C3 added `externalIntakeRoots: string[]` as a path-validation allowlist so users can intake projects from outside the scan root — but those intake'd projects only appear in Podium if the user navigates away and back, and only via the orchestration registry, not the scanner. A project intake'd from `D:\repos` into the allowlist doesn't show up in the Tracked or Discovered sections because the scanner never looks there.

C5 closes this gap. When Podium refreshes, it scans the primary scan root **and** every directory in `externalIntakeRoots`, merges the results with deduplication, and renders them in a single unified list. Projects intake'd via C3 appear on the next refresh without the user needing to change their scan root or move directories around.

This is the natural completion of C3: C3 lets you write `.factory/` outside the scan root; C5 lets Podium see it.

## Resolved design decisions

### D1. Reuse `externalIntakeRoots` — no new setting

The `externalIntakeRoots` client setting already contains the parent directories the user has explicitly approved. Scanning those same directories is the behavior users expect: "I told Attacca about `D:\repos`, so Podium should show me what's there."

Adding a separate `additionalScanRoots` setting would force users to configure two lists that almost always contain the same entries. One list, two purposes (write allowlist + scan roots).

**Trade-off acknowledged**: a user might want to allowlist a directory for intake without having Podium scan it (e.g., a noisy parent with 200 subdirectories). v0 does not support this — all `externalIntakeRoots` are scanned. If this proves to be a real problem, a future iteration can add a per-root `scan: boolean` flag or a separate `externalIntakeRootsNoScan` list. The escape hatch today is `ATTACCA_PODIUM_EXCLUDE` for noisy directory names.

### D2. Client makes one RPC per root, merges client-side

Two options were considered:

- **A. Server accepts `rootDirs: string[]`, returns merged results.** Cleaner API, but the server would need the dedup logic, the per-root error handling, and the merge sort. The scanner today is a pure function of one directory — adding multi-root makes it stateful (which roots failed? which succeeded?) and harder to test.
- **B. Client calls `factory.scanProjects` once per root, merges results.** Each call is independent, failures are isolated, the server scanner stays simple.

**Decision: B.** The client already knows the root list. It calls `scanProjects({ rootDir })` N times (once for the primary root, once for each `externalIntakeRoots` entry), collects the results, deduplicates, and merges into the store. This keeps the server scanner unchanged — zero server-side changes for C5.

**Performance**: calls are issued in parallel via `Promise.allSettled`. Each root scans independently; a slow or failing root doesn't block the others. For the expected case (1 primary + 1-3 external roots), total scan time is dominated by the slowest single root, not the sum.

### D3. Deduplication by normalized absolute path

The same project directory could appear under multiple roots if:

- The user's primary scan root is `~/projects` and they also have `~/projects` in `externalIntakeRoots` (redundant but plausible after a settings edit).
- A symlink or junction makes the same directory reachable from two roots.

Dedup key: `normalizeCwd(project.path)` — the same helper C1 and C3 already use (lowercase, forward slashes, trailing slash stripped). If two `ScannedProject` entries have the same normalized path, keep the one from the primary scan root (it has "home advantage"). If neither is from the primary root, keep the first one encountered.

This is a simple first-writer-wins strategy. No attempt to resolve symlinks or detect hardlinks — that's filesystem-level complexity with minimal user benefit.

### D4. Per-root failure isolation — show what you can

If one root is unreachable (doesn't exist, permission denied, network drive offline), the scan for that root returns `[]` — the scanner already handles this gracefully (B3 fix in `6983adbe`). The client collects successful results from the other roots and renders them normally.

A non-blocking warning appears below the header: "Could not scan `D:\repos` (directory not found)" or similar. This is a toast or an inline warning, not the full-page error card. The user sees their projects from the roots that worked and knows which root failed.

### D5. No per-root grouping in the UI — single merged list

Two options:

- **A. Group by root**: "Projects from ~/projects", "Projects from D:\repos" — visually segmented.
- **B. Single merged list**: all projects together, sorted by the existing rules (factory first, then alphabetical within tracked/discovered).

**Decision: B for v0.** The root a project lives under is an implementation detail the user doesn't need to think about. They care about phase, health, and staleness — not which parent directory the project happens to be in. The project path is already displayed on each row, which is sufficient to locate it on disk.

If users later want to filter by root, that's a future enhancement (per-root filter chips in the header). Not v0.

### D6. `ScannedProject` gets an optional `scanRoot` field

Even though the UI doesn't group by root in v0, the merge logic needs to know which root a project came from for dedup (D3) and failure reporting (D4). Adding `scanRoot: string` to the client-side project representation (not the contracts schema — this is a client-only enrichment) lets the store track provenance without changing the server contract.

Implementation: the client wraps each `scanProjects` result and stamps `scanRoot` onto each project before merging.

## v0 scope

Three implementation tasks, in build order:

1. **Podium store: multi-root scan + merge** — modify `usePodiumStore.scan()` to read `externalIntakeRoots` from client settings, issue `factory.scanProjects` in parallel for each root (primary + externals), merge results with dedup by normalized path, and store the merged list. The store gains a new `scanRoots: string[]` field (the list of roots that were scanned) and a `scanWarnings: string[]` field for per-root failure messages. The `rootDir` field stays as the primary root for backward compat.

2. **Podium store: pass settings into scan** — `scan()` currently receives an optional `overrideRoot` string. Extend it to also receive the `externalIntakeRoots` array. The Podium route already has access to `externalIntakeRoots` via `useSettings` — wire it through. Alternatively, `scan()` reads settings directly from localStorage (matching how `podiumScanRootOverride` is handled today). Either approach works; pick whichever is simpler during implementation.

3. **Dashboard: scan warnings UI** — if `scanWarnings` is non-empty, render a small inline warning block below the Podium header showing which roots failed and why. Dismissible for the session (not persisted). No changes to the Tracked/Discovered/Stalled sections — they render the merged list as before.

## v0 non-behaviors

Explicitly not building:

- **Per-root UI grouping or filtering.** All projects render in a single merged list. No "Projects from ~/projects" section headers, no filter chips by root.
- **Server-side multi-root scanning.** The `ScanProjectsInput` schema stays `{ rootDir?: string }`. The server scanner is called once per root by the client. No new RPC method.
- **Scan root management UI.** Users manage `externalIntakeRoots` through the existing settings panel (C7) and the intake consent flow (C3). C5 adds no new UI for adding/removing scan roots.
- **Per-root exclude lists.** The `ATTACCA_PODIUM_EXCLUDE` env var applies globally to all roots. No per-root exclude configuration.
- **Caching or incremental scanning.** Every refresh re-scans all roots from scratch. For the expected scale (1-5 roots, 10-50 projects each), this completes in well under a second. Caching is a C8 concern if scale grows.
- **Symlink/junction resolution for dedup.** Dedup is by string comparison on normalized paths only. Two different paths pointing to the same directory via symlinks are treated as two projects.
- **`additionalScanRoots` or any new client setting.** C5 reuses `externalIntakeRoots` exclusively.

## Integration boundaries

- **Client settings**: reads `externalIntakeRoots` from `ClientSettingsSchema` (already exists from C3). No new settings fields.
- **Server scanner**: zero changes. `factory.scanProjects` continues to accept `{ rootDir?: string }` and return `{ rootDir, projects }`. The client calls it multiple times.
- **Podium store** (`apps/web/src/stores/podium.ts`): the `scan()` method is the only function that changes. Selectors (`selectTrackedProjects`, `selectDiscoveredProjects`, `selectStalledProjects`) operate on `state.projects` and are agnostic to where the projects came from — no selector changes needed.
- **Dashboard route** (`apps/web/src/routes/_chat.podium.tsx`): minimal changes — pass `externalIntakeRoots` into the scan call, render `scanWarnings` if present. The `useEffect` that triggers scan on mount already has `podiumScanRootOverride` in its dependency array; adding `externalIntakeRoots` there ensures a re-scan when the user adds a new intake root.
- **Contracts** (`packages/contracts/src/factory.ts`): no changes. `ScanProjectsInput` and `ScanProjectsResult` stay as-is.

## Behavioral scenarios

### v0 Scenario 1 — Primary root + one external root, no overlap

**Given** the primary scan root is `C:\Users\jhon1\projects` (3 projects, 2 with `.factory/`) and `externalIntakeRoots` is `["D:\\repos"]` (2 projects, both with `.factory/`)
**When** the user opens Podium or clicks Refresh
**Then**:

1. The client calls `factory.scanProjects({ rootDir: "C:\\Users\\jhon1\\projects" })` and `factory.scanProjects({ rootDir: "D:\\repos" })` in parallel.
2. Both calls succeed.
3. The store merges results: 4 tracked projects (sorted by `lastActivity DESC`), 1 discovered project (sorted alphabetically).
4. The dashboard renders all 5 projects in the usual Tracked/Discovered sections.
5. No scan warnings.

### v0 Scenario 2 — One external root fails

**Given** the primary scan root is `~/projects` (works fine) and `externalIntakeRoots` is `["Z:\\network-drive"]` (offline)
**When** the user clicks Refresh
**Then**:

1. `scanProjects({ rootDir: "~/projects" })` succeeds with 5 projects.
2. `scanProjects({ rootDir: "Z:\\network-drive" })` returns `[]` (the scanner's existing behavior for unreachable directories).
3. The store sets `scanWarnings: ["Could not scan Z:\\network-drive"]`.
4. The dashboard renders 5 projects from `~/projects` normally.
5. An inline warning below the header reads: "Could not scan Z:\network-drive".
6. The warning is dismissible.

### v0 Scenario 3 — Duplicate project across roots

**Given** the primary scan root is `~/projects` which contains `~/projects/acme-api`, and `externalIntakeRoots` is `["~/projects"]` (user accidentally added it)
**When** the user clicks Refresh
**Then**:

1. Both scan calls return `acme-api` at `~/projects/acme-api`.
2. Dedup by normalized path keeps the instance from the primary root scan.
3. `acme-api` appears exactly once in the dashboard.

### v0 Scenario 4 — External root added via C3 intake, project appears on next refresh

**Given** the user just intake'd a project at `D:\repos\widget-service` via C3, which added `D:\repos` to `externalIntakeRoots`
**When** the user navigates back to Podium (or the intake flow triggers a refresh)
**Then**:

1. The scan includes `D:\repos` as an additional root.
2. `widget-service` appears in the Tracked section (it has `.factory/` from the intake flow).
3. Any other projects under `D:\repos` also appear (as Tracked if they have `.factory/`, Discovered otherwise).

### v0 Scenario 5 — No external roots configured

**Given** `externalIntakeRoots` is `[]` (default, no C3 intake has been done)
**When** the user opens Podium
**Then** behavior is identical to today: one scan of the primary root, no merge, no warnings. C5 is a no-op enhancement that doesn't change the baseline experience.

### v0 Scenario 6 — Empty primary root, populated external root

**Given** the primary scan root is `~/projects` (empty directory, no subdirectories) and `externalIntakeRoots` is `["D:\\repos"]` (3 projects)
**When** the user opens Podium
**Then**:

1. Primary scan returns `[]`.
2. External scan returns 3 projects.
3. Dashboard renders 3 projects. No empty-state screen — the empty state only shows when _all_ roots return zero projects combined.

### v0 Scenario 7 — All roots return zero projects

**Given** the primary scan root is `~/projects` (empty) and `externalIntakeRoots` is `["D:\\repos"]` (also empty)
**When** the user opens Podium
**Then** the empty state renders as today: "No projects found" with a hint about the scan root. The hint could mention that external roots were also scanned and came up empty.

## Open questions (resolve during implementation, not blocking v0 spec)

1. **Should the scan re-trigger when `externalIntakeRoots` changes?** Probably yes — the `useEffect` in the Podium route should include `externalIntakeRoots` in its dependency array so adding a root via C3 intake (which updates settings) triggers a re-scan automatically. But verify this doesn't cause double-scans when the intake flow itself already refreshes.

2. **Failure detection for external roots**: the scanner returns `[]` for both "empty directory" and "unreachable directory". The client can't distinguish between "D:\repos exists but has no projects" and "D:\repos doesn't exist". Should the client pre-check `existsSync` on each root? That requires a new server RPC or desktop bridge call. Lean: don't pre-check, just note in the warning that "returned 0 projects" without claiming the directory is missing. The scan root settings panel already shows the configured roots, so the user can spot a typo there.

3. **Order of roots for dedup priority**: the spec says "primary root wins". If the user has `podiumScanRootOverride` set, is that the primary root or the env/default root? It should be the override (that's what's displayed as `rootDir` in the store). Verify during implementation.

## Dependencies

- **C3 external intake** (shipped) — provides `externalIntakeRoots` setting and the intake consent flow that populates it.
- **C7 settings UI** (shipped, `8b3c794d`) — provides the settings panel where users can view/remove entries from `externalIntakeRoots`.
- **B3 scanner error handling** (shipped, `6983adbe`) — the scanner returns `[]` on permission errors instead of throwing, which is the foundation for per-root failure isolation.

All dependencies are shipped.

## Out of scope (future work)

- **Per-root filter UI** — chips or dropdown to show/hide projects from specific roots
- **Per-root exclude lists** — different exclude patterns for different roots
- **Server-side multi-root** — `ScanProjectsInput` accepting `rootDirs: string[]`
- **Scan caching / incremental refresh** — remember previous scan results, only re-scan changed roots
- **Symlink-aware dedup** — resolve symlinks/junctions to detect same-directory-different-path
- **`additionalScanRoots` setting** — separate setting for scan-only roots (not tied to intake allowlist)

## Review checklist

Before building v0, confirm:

- [ ] Reusing `externalIntakeRoots` (no new setting) is the right call for v0.
- [ ] Client-side multi-call + merge (not server-side multi-root) is the right architecture.
- [ ] Dedup by normalized path with primary-root priority is sufficient.
- [ ] Single merged list (no per-root grouping) is the right UI for v0.
- [ ] Inline warning for failed roots (not error card, not toast) is the right UX.
- [ ] Zero server-side changes is correct — no contracts or scanner modifications.
- [ ] The build order (store logic -> settings wiring -> warning UI) has no hidden dependencies.
