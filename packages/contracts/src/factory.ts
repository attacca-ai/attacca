/**
 * .factory/ Protocol Types
 *
 * The .factory/ directory is the shared contract between all Attacca modes:
 * Stand (dev workstation), Podium (factory orchestrator), Arco (personal agent).
 *
 * See: docs/factory-protocol.md
 */

import { Schema } from "effect";

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

export const SyncState = Schema.Literals(["in_sync", "drift_detected", "update_pending", "missing"]);
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
  // Optional
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
