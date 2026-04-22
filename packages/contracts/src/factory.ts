/**
 * .factory/ Protocol Types
 *
 * The .factory/ directory is the shared contract between all Attacca modes:
 * Stand (dev workstation), Podium (factory orchestrator), Arco (personal agent).
 *
 * See: docs/factory-protocol.md
 */

import { Effect, Schema } from "effect";

// ---------------------------------------------------------------------------
// Protocol version
// ---------------------------------------------------------------------------

/**
 * Current `.factory/` protocol version.
 *
 * Bumped when the on-disk layout or required fields change in a way that
 * older clients cannot safely read. The reader migrates missing versions
 * to 1 for backward compatibility with pre-versioned (Phase 1) configs.
 *
 * Independent of the `attacca-forge` npm package version, which versions
 * skills, not protocol.
 */
export const FACTORY_PROTOCOL_VERSION = 1 as const;

/** 7 days in milliseconds — used by both gap analyzer and client selectors. */
export const STALLED_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Enums & Literals
// ---------------------------------------------------------------------------

export const TrustTier = Schema.Literals([1, 2, 3, 4]);
export type TrustTier = typeof TrustTier.Type;

export const Phase = Schema.Literals([
  "IDEA",
  "DISCOVER",
  "SPEC",
  "BUILD",
  "TEST",
  "CERTIFY",
  "DEPLOY",
  "MAINTAIN",
]);
export type Phase = typeof Phase.Type;

export const ProjectType = Schema.Literals(["greenfield", "brownfield"]);
export type ProjectType = typeof ProjectType.Type;

export const ProjectTrack = Schema.Literals(["software", "service"]);
export type ProjectTrack = typeof ProjectTrack.Type;

export const Health = Schema.Literals(["active", "stalled", "blocked", "archived"]);
export type Health = typeof Health.Type;

export const WorkItemType = Schema.Literals(["spec_gap", "bug", "enhancement", "feature"]);
export type WorkItemType = typeof WorkItemType.Type;

export const WorkItemStatus = Schema.Literals(["pending", "in_progress", "done", "blocked"]);
export type WorkItemStatus = typeof WorkItemStatus.Type;

export const WorkItemPriority = Schema.Literals(["high", "medium", "low"]);
export type WorkItemPriority = typeof WorkItemPriority.Type;

// ---------------------------------------------------------------------------
// Gap analysis (Podium mode)
// ---------------------------------------------------------------------------

export const GapCategory = Schema.Literals([
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
export type GapCategory = typeof GapCategory.Type;

export const GapSeverity = Schema.Literals(["high", "medium", "low"]);
export type GapSeverity = typeof GapSeverity.Type;

export const Gap = Schema.Struct({
  category: GapCategory,
  severity: GapSeverity,
  message: Schema.String,
  suggestedSkill: Schema.optional(Schema.String),
});
export type Gap = typeof Gap.Type;

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------

export const SyncState = Schema.Literals([
  "in_sync",
  "drift_detected",
  "update_pending",
  "missing",
]);
export type SyncState = typeof SyncState.Type;

export const SyncSeverity = Schema.Literals(["minor", "major", "critical"]);
export type SyncSeverity = typeof SyncSeverity.Type;

export const ExperienceLevel = Schema.Literals(["new", "comfortable", "expert"]);
export type ExperienceLevel = typeof ExperienceLevel.Type;

// ---------------------------------------------------------------------------
// .factory/config.yaml
// ---------------------------------------------------------------------------

export const FactoryConfig = Schema.Struct({
  name: Schema.String,
  display_name: Schema.String,
  type: ProjectType,
  trust_tier: TrustTier,
  phase: Phase,
  track: ProjectTrack,
  version: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(FACTORY_PROTOCOL_VERSION))),
  stack: Schema.optional(Schema.Array(Schema.String)),
  repo: Schema.optional(Schema.String),
  assigned_dev: Schema.optional(Schema.String),
  created: Schema.optional(Schema.String),
  updated: Schema.optional(Schema.String),
  experience_level: Schema.optional(ExperienceLevel),
  completed_phases: Schema.optional(Schema.Array(Phase)),
});
export type FactoryConfig = typeof FactoryConfig.Type;

// ---------------------------------------------------------------------------
// .factory/status.json
// ---------------------------------------------------------------------------

export const FactoryStatus = Schema.Struct({
  state: Phase,
  health: Health,
  next_action: Schema.optional(Schema.String),
  completion_pct: Schema.optional(Schema.Number),
  gap_count: Schema.optional(Schema.Number),
  last_activity: Schema.optional(Schema.String),
  assigned_dev: Schema.optional(Schema.String),
  track: ProjectTrack,
  archived: Schema.Boolean,
});
export type FactoryStatus = typeof FactoryStatus.Type;

// ---------------------------------------------------------------------------
// .factory/queue.json
// ---------------------------------------------------------------------------

export const WorkItem = Schema.Struct({
  id: Schema.String,
  priority: WorkItemPriority,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  spec_section: Schema.optional(Schema.String),
  type: WorkItemType,
  status: WorkItemStatus,
  estimated_complexity: Schema.optional(Schema.Literals(["low", "medium", "high"])),
  github_issue: Schema.optional(Schema.NullOr(Schema.String)),
});
export type WorkItem = typeof WorkItem.Type;

export const WorkQueue = Schema.Struct({
  version: Schema.Number,
  generated: Schema.String,
  generated_by: Schema.String,
  items: Schema.Array(WorkItem),
});
export type WorkQueue = typeof WorkQueue.Type;

// ---------------------------------------------------------------------------
// .factory/sync-status.json
// ---------------------------------------------------------------------------

export const SyncSectionEvidence = Schema.Struct({
  spec_mentions: Schema.optional(Schema.Array(Schema.String)),
  test_files: Schema.optional(Schema.Array(Schema.String)),
  code_files: Schema.optional(Schema.Array(Schema.String)),
  notes: Schema.optional(Schema.String),
});
export type SyncSectionEvidence = typeof SyncSectionEvidence.Type;

export const SyncSection = Schema.Struct({
  spec_section: Schema.String,
  title: Schema.String,
  spec_sync: SyncState,
  tests_sync: SyncState,
  code_sync: SyncState,
  severity: SyncSeverity,
  evidence: Schema.optional(SyncSectionEvidence),
});
export type SyncSection = typeof SyncSection.Type;

export const SyncStatusSummary = Schema.Struct({
  total_sections: Schema.Number,
  in_sync: Schema.Number,
  drift_detected: Schema.Number,
  missing: Schema.Number,
});
export type SyncStatusSummary = typeof SyncStatusSummary.Type;

export const SyncStatus = Schema.Struct({
  last_scan: Schema.String,
  spec_hash: Schema.optional(Schema.String),
  overall_sync: SyncState,
  sections: Schema.Array(SyncSection),
  summary: SyncStatusSummary,
});
export type SyncStatus = typeof SyncStatus.Type;

// ---------------------------------------------------------------------------
// .factory/progress/session-*.json
// ---------------------------------------------------------------------------

export const SessionCommit = Schema.Struct({
  sha: Schema.String,
  message: Schema.String,
  files_changed: Schema.Number,
});
export type SessionCommit = typeof SessionCommit.Type;

export const AomeFleetOutput = Schema.Struct({
  spec_gaps_closed: Schema.Number,
  scenarios_passing_delta: Schema.Number,
});

export const AomeOrchestrationQuality = Schema.Struct({
  first_try_completions: Schema.Number,
  correction_rounds: Schema.Number,
});

export const AomeEscalationHealth = Schema.Struct({
  escalations_total: Schema.Number,
  escalations_appropriate: Schema.Number,
});

export const AomeContextIntegrity = Schema.Struct({
  spec_referenced: Schema.Boolean,
  factory_updated: Schema.Boolean,
});

export const AomeSnapshot = Schema.Struct({
  fleet_output: AomeFleetOutput,
  orchestration_quality: AomeOrchestrationQuality,
  escalation_health: AomeEscalationHealth,
  context_integrity: AomeContextIntegrity,
});
export type AomeSnapshot = typeof AomeSnapshot.Type;

export const SessionLog = Schema.Struct({
  session_id: Schema.String,
  dev: Schema.String,
  started: Schema.String,
  ended: Schema.optional(Schema.String),
  duration_minutes: Schema.optional(Schema.Number),
  work_items_completed: Schema.optional(Schema.Array(Schema.String)),
  work_items_in_progress: Schema.optional(Schema.Array(Schema.String)),
  commits: Schema.optional(Schema.Array(SessionCommit)),
  files_changed: Schema.optional(Schema.Number),
  tests_run: Schema.optional(Schema.Number),
  tests_passed: Schema.optional(Schema.Number),
  tests_failed: Schema.optional(Schema.Number),
  agent_interactions: Schema.optional(Schema.Number),
  escalations: Schema.optional(Schema.Number),
  notes: Schema.optional(Schema.String),
  aome: Schema.optional(AomeSnapshot),
});
export type SessionLog = typeof SessionLog.Type;

// ---------------------------------------------------------------------------
// .factory/ directory aggregate (read result)
// ---------------------------------------------------------------------------

export const FactoryDirectory = Schema.Struct({
  exists: Schema.Boolean,
  path: Schema.String,
  config: Schema.NullOr(FactoryConfig),
  status: Schema.NullOr(FactoryStatus),
  queue: Schema.NullOr(WorkQueue),
  syncStatus: Schema.NullOr(SyncStatus),
  specContent: Schema.NullOr(Schema.String),
  contextContent: Schema.NullOr(Schema.String),
  intentContract: Schema.NullOr(Schema.String),
  scenarios: Schema.NullOr(Schema.String),
  sessions: Schema.Array(SessionLog),
  claudeMd: Schema.NullOr(Schema.String),
});
export type FactoryDirectory = typeof FactoryDirectory.Type;

// ---------------------------------------------------------------------------
// Forge skills
// ---------------------------------------------------------------------------

export const ForgeSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  path: Schema.String,
});
export type ForgeSkill = typeof ForgeSkill.Type;

export const ForgeSkillListResult = Schema.Struct({
  skills: Schema.Array(ForgeSkill),
  source: Schema.String,
});
export type ForgeSkillListResult = typeof ForgeSkillListResult.Type;

// ---------------------------------------------------------------------------
// Regenerated CLAUDE.md
// ---------------------------------------------------------------------------

export const FactoryRegenerateClaudeMdResult = Schema.Struct({
  content: Schema.String,
  generatedAt: Schema.String,
});
export type FactoryRegenerateClaudeMdResult = typeof FactoryRegenerateClaudeMdResult.Type;

// ---------------------------------------------------------------------------
// RPC inputs / outputs
// ---------------------------------------------------------------------------

/**
 * Client-side allowlist of extra directories the server may write into,
 * in addition to the resolved Podium scan root. Populated from the
 * `externalIntakeRoots` client setting on every write RPC call. Absent or
 * empty means "no extra roots, write must stay inside the scan root".
 */
const AllowedRoots = Schema.optional(Schema.Array(Schema.String));

export const FactoryProjectPathInput = Schema.Struct({
  projectPath: Schema.String,
  allowedRoots: AllowedRoots,
});
export type FactoryProjectPathInput = typeof FactoryProjectPathInput.Type;

export const FactoryReadSummaryResult = Schema.Struct({
  config: Schema.NullOr(FactoryConfig),
  status: Schema.NullOr(FactoryStatus),
});
export type FactoryReadSummaryResult = typeof FactoryReadSummaryResult.Type;

export const FactoryInitializeInput = Schema.Struct({
  projectPath: Schema.String,
  config: FactoryConfig,
  autoDetectType: Schema.optional(Schema.Boolean),
  allowedRoots: AllowedRoots,
});
export type FactoryInitializeInput = typeof FactoryInitializeInput.Type;

export const FactoryWriteQueueInput = Schema.Struct({
  projectPath: Schema.String,
  queue: WorkQueue,
  allowedRoots: AllowedRoots,
});
export type FactoryWriteQueueInput = typeof FactoryWriteQueueInput.Type;

export const FactoryWriteSessionLogInput = Schema.Struct({
  projectPath: Schema.String,
  session: SessionLog,
  allowedRoots: AllowedRoots,
});
export type FactoryWriteSessionLogInput = typeof FactoryWriteSessionLogInput.Type;

// ---------------------------------------------------------------------------
// Gap dispatch (Podium mode)
// ---------------------------------------------------------------------------

export const DispatchWorkPackageInput = Schema.Struct({
  projectPath: Schema.String,
  gap: Gap,
  allowedRoots: AllowedRoots,
});
export type DispatchWorkPackageInput = typeof DispatchWorkPackageInput.Type;

export const DispatchWorkPackageResult = Schema.Struct({
  workItem: WorkItem,
});
export type DispatchWorkPackageResult = typeof DispatchWorkPackageResult.Type;

// ---------------------------------------------------------------------------
// Scanner (Podium mode)
// ---------------------------------------------------------------------------

export const ScannedProject = Schema.Struct({
  slug: Schema.String,
  displayName: Schema.String,
  path: Schema.String,
  hasFactory: Schema.Boolean,
  phase: Phase,
  health: Health,
  track: ProjectTrack,
  trustTier: Schema.Number,
  completionPct: Schema.Number,
  gapCount: Schema.Number,
  gaps: Schema.Array(Gap),
  assignedDev: Schema.NullOr(Schema.String),
  nextAction: Schema.NullOr(Schema.String),
  lastActivity: Schema.NullOr(Schema.String),
  repo: Schema.NullOr(Schema.String),
  stack: Schema.Array(Schema.String),
});
export type ScannedProject = typeof ScannedProject.Type;

export const ScanProjectsInput = Schema.Struct({
  rootDir: Schema.optional(Schema.String),
});
export type ScanProjectsInput = typeof ScanProjectsInput.Type;

export const ScanProjectsResult = Schema.Struct({
  rootDir: Schema.String,
  projects: Schema.Array(ScannedProject),
  warning: Schema.NullOr(Schema.String),
});
export type ScanProjectsResult = typeof ScanProjectsResult.Type;

export const PodiumRootResult = Schema.Struct({
  rootDir: Schema.String,
  source: Schema.Literals(["env", "default"]),
});
export type PodiumRootResult = typeof PodiumRootResult.Type;

// ---------------------------------------------------------------------------
// Identity (Phase 2)
// ---------------------------------------------------------------------------

export const GitIdentityResult = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  source: Schema.Literals(["git", "os", "none"]),
});
export type GitIdentityResult = typeof GitIdentityResult.Type;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FactoryReadError extends Schema.TaggedErrorClass<FactoryReadError>()(
  "FactoryReadError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class FactoryWriteError extends Schema.TaggedErrorClass<FactoryWriteError>()(
  "FactoryWriteError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * Thrown when a `.factory/config.yaml` declares a protocol version higher
 * than the current client supports. Surfaces as a user-facing error in the
 * UI: "This project uses .factory/ protocol v{foundVersion} but this Attacca
 * client supports up to v{supportedVersion}. Update Attacca or downgrade
 * the project."
 */
export class FactoryProtocolVersionError extends Schema.TaggedErrorClass<FactoryProtocolVersionError>()(
  "FactoryProtocolVersionError",
  {
    message: Schema.String,
    foundVersion: Schema.Number,
    supportedVersion: Schema.Number,
    projectPath: Schema.String,
  },
) {}

/**
 * Thrown when a write RPC targets a path that is not inside the resolved
 * Podium scan root. Defense-in-depth against arbitrary filesystem writes
 * via the WebSocket boundary. The typed shape lets the UI distinguish this
 * from generic write errors.
 */
export class FactoryPathError extends Schema.TaggedErrorClass<FactoryPathError>()(
  "FactoryPathError",
  {
    message: Schema.String,
    projectPath: Schema.String,
    scanRoot: Schema.String,
  },
) {}

// ---------------------------------------------------------------------------
// Factory directory paths (constants)
// ---------------------------------------------------------------------------

export const FACTORY_DIR = ".factory";
export const FACTORY_FILES = {
  CONFIG: "config.yaml",
  CLAUDE_MD: "CLAUDE.md",
  AGENTS_MD: "AGENTS.md",
  CONTEXT: "context.md",
  STATUS: "status.json",
  SPEC: "spec.md",
  INTENT_CONTRACT: "intent-contract.md",
  SCENARIOS: "scenarios.md",
  QUEUE: "queue.json",
  SYNC_STATUS: "sync-status.json",
  PROGRESS_DIR: "progress",
  DECISIONS_DIR: "decisions",
  ARTIFACTS_DIR: "artifacts",
} as const;
