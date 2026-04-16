/**
 * Gap Analyzer
 *
 * Inspects a project's .factory/ directory and evaluates it against the
 * factory protocol requirements for its declared phase and trust tier.
 * Returns a typed list of gaps — protocol violations or missing prerequisites.
 *
 * Pure function: reads filesystem for existence checks, no writes, no LLM calls.
 * All checks are deterministic filesystem predicates.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  FACTORY_DIR,
  FACTORY_FILES,
  STALLED_THRESHOLD_MS,
  type FactoryConfig,
  type FactoryStatus,
  type Gap,
  type GapCategory,
  type GapSeverity,
  type Phase,
  type WorkQueue,
} from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Phase ordering for >= comparisons
// ---------------------------------------------------------------------------

const PHASE_ORDER: Record<Phase, number> = {
  IDEA: 0,
  DISCOVER: 1,
  SPEC: 2,
  BUILD: 3,
  TEST: 4,
  CERTIFY: 5,
  DEPLOY: 6,
  MAINTAIN: 7,
};

function phaseAtLeast(current: Phase, threshold: Phase): boolean {
  return PHASE_ORDER[current] >= PHASE_ORDER[threshold];
}

/** Phases where staleness is meaningful (active work expected). */
const ACTIVE_PHASES: ReadonlySet<Phase> = new Set(["BUILD", "TEST", "DEPLOY"]);

// STALLED_THRESHOLD_MS imported from contracts

// ---------------------------------------------------------------------------
// Gap builder helper
// ---------------------------------------------------------------------------

function gap(
  category: GapCategory,
  severity: GapSeverity,
  message: string,
  suggestedSkill?: string,
): Gap {
  if (suggestedSkill !== undefined) {
    return { category, severity, message, suggestedSkill };
  }
  return { category, severity, message };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a project's .factory/ directory for protocol compliance gaps.
 *
 * @param projectPath - Absolute path to the project root
 * @param config - Parsed config.yaml (null if missing/unparseable)
 * @param status - Parsed status.json (null if missing/unparseable)
 * @param queue - Parsed queue.json (null if missing/unparseable), avoids re-reading from disk
 * @returns Array of gaps, ordered by severity (high → low)
 */
export function analyzeGaps(
  projectPath: string,
  config: FactoryConfig | null,
  status: FactoryStatus | null,
  queue?: WorkQueue | null,
): Gap[] {
  const factoryPath = join(projectPath, FACTORY_DIR);
  const gaps: Gap[] = [];

  // G1: missing_config — always applies
  if (config === null) {
    gaps.push(
      gap("missing_config", "high", "config.yaml does not exist or failed to parse."),
    );
  }

  // G2: missing_status — always applies
  if (status === null) {
    gaps.push(
      gap("missing_status", "high", "status.json does not exist or failed to parse."),
    );
  }

  // Remaining checks use config/status fields — if both are missing we can't
  // evaluate phase/tier gated rules, so return early with the critical gaps.
  const phase = config?.phase ?? status?.state ?? "IDEA";
  const trustTier = config?.trust_tier ?? 2;

  // G3: missing_spec — phase >= SPEC
  if (phaseAtLeast(phase, "SPEC")) {
    const specPath = join(factoryPath, FACTORY_FILES.SPEC);
    if (!existsSync(specPath) || isEmptyFile(specPath)) {
      gaps.push(
        gap(
          "missing_spec",
          "medium",
          "spec.md does not exist. Projects in SPEC phase require a specification.",
          "attacca-forge:spec-writer",
        ),
      );
    }
  }

  // G4: missing_context — always applies
  {
    const contextPath = join(factoryPath, FACTORY_FILES.CONTEXT);
    if (!existsSync(contextPath) || isEmptyFile(contextPath)) {
      gaps.push(
        gap(
          "missing_context",
          "low",
          "context.md does not exist or is empty.",
          "attacca-forge:codebase-discovery",
        ),
      );
    }
  }

  // G5: empty_queue — phase >= BUILD
  if (phaseAtLeast(phase, "BUILD")) {
    const hasPending = queue?.items.some((item) => item.status === "pending") ?? false;
    if (!hasPending) {
      gaps.push(
        gap(
          "empty_queue",
          "low",
          "queue.json does not exist or has zero pending items.",
          "attacca-forge:build-orchestrator",
        ),
      );
    }
  }

  // G6: no_session_logs — phase >= BUILD
  if (phaseAtLeast(phase, "BUILD")) {
    const progressDir = join(factoryPath, FACTORY_FILES.PROGRESS_DIR);
    if (!existsSync(progressDir) || isEmptyDir(progressDir)) {
      gaps.push(
        gap("no_session_logs", "low", "No session logs found in .factory/progress/."),
      );
    }
  }

  // G7: stale_activity — only for active phases (BUILD, TEST, DEPLOY)
  if (ACTIVE_PHASES.has(phase) && status?.last_activity) {
    const last = Date.parse(status.last_activity);
    if (Number.isFinite(last) && Date.now() - last > STALLED_THRESHOLD_MS) {
      gaps.push(
        gap("stale_activity", "low", "Last activity is older than 7 days."),
      );
    }
  }

  // G8: missing_intent_contract — trust_tier >= 3
  if (trustTier >= 3) {
    const intentPath = join(factoryPath, FACTORY_FILES.INTENT_CONTRACT);
    if (!existsSync(intentPath)) {
      gaps.push(
        gap(
          "missing_intent_contract",
          "medium",
          "intent-contract.md does not exist. Trust tier 3+ requires an intent contract.",
          "attacca-forge:intent-spec",
        ),
      );
    }
  }

  // G9: missing_scenarios — phase >= SPEC and trust_tier >= 2
  if (phaseAtLeast(phase, "SPEC") && trustTier >= 2) {
    const scenariosPath = join(factoryPath, FACTORY_FILES.SCENARIOS);
    if (!existsSync(scenariosPath) || isEmptyFile(scenariosPath)) {
      gaps.push(
        gap(
          "missing_scenarios",
          "medium",
          "scenarios.md does not exist or is empty.",
          "attacca-forge:spec-architect",
        ),
      );
    }
  }

  // G10: incomplete_config — phase >= BUILD, checks assigned_dev/stack/repo
  if (phaseAtLeast(phase, "BUILD") && config !== null) {
    const missing: string[] = [];
    if (!config.assigned_dev) missing.push("assigned_dev");
    if (!config.stack || config.stack.length === 0) missing.push("stack");
    if (!config.repo) missing.push("repo");
    if (missing.length > 0) {
      gaps.push(
        gap(
          "incomplete_config",
          "low",
          `config.yaml is missing ${missing.join(", ")} for a BUILD-phase project.`,
        ),
      );
    }
  }

  // Sort: high → medium → low
  const severityOrder: Record<GapSeverity, number> = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return gaps;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function isEmptyFile(filePath: string): boolean {
  try {
    return statSync(filePath).size === 0;
  } catch {
    return true;
  }
}

function isEmptyDir(dirPath: string): boolean {
  try {
    return readdirSync(dirPath).length === 0;
  } catch {
    return true;
  }
}

