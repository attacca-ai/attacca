/**
 * .factory/ directory writer
 *
 * Creates and updates files in a project's .factory/ directory.
 * Used by Stand (session logs, status updates) and Podium (queue dispatch, gap analysis).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FACTORY_DIR,
  FACTORY_FILES,
  FACTORY_PROTOCOL_VERSION,
  type FactoryConfig,
  type FactoryStatus,
  type WorkQueue,
  type SyncStatus,
  type SessionLog,
} from "@t3tools/contracts";

import { readFactoryDirectory } from "./reader";

// ---------------------------------------------------------------------------
// YAML serializer (minimal, config.yaml only)
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe embedding inside a double-quoted YAML scalar.
 * Handles backslash, double quote, and control characters. Windows paths
 * (containing `\`) and directory names with `"` would otherwise corrupt
 * the config or inject forged fields.
 */
function yamlQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function configToYaml(config: FactoryConfig): string {
  const lines: string[] = [];

  lines.push(`version: ${FACTORY_PROTOCOL_VERSION}`);
  lines.push(`name: ${yamlQuote(config.name)}`);
  lines.push(`display_name: ${yamlQuote(config.display_name)}`);
  lines.push(`type: ${yamlQuote(config.type)}`);
  lines.push(`trust_tier: ${config.trust_tier}`);
  lines.push(`phase: ${yamlQuote(config.phase)}`);
  lines.push(`track: ${yamlQuote(config.track)}`);

  if (config.stack?.length) {
    lines.push("stack:");
    for (const s of config.stack) lines.push(`  - ${yamlQuote(s)}`);
  }
  if (config.repo) lines.push(`repo: ${yamlQuote(config.repo)}`);
  if (config.assigned_dev) lines.push(`assigned_dev: ${yamlQuote(config.assigned_dev)}`);
  if (config.created) lines.push(`created: ${yamlQuote(config.created)}`);
  if (config.updated) lines.push(`updated: ${yamlQuote(config.updated)}`);
  if (config.experience_level) lines.push(`experience_level: ${yamlQuote(config.experience_level)}`);
  if (config.completed_phases?.length) {
    lines.push("completed_phases:");
    for (const p of config.completed_phases) lines.push(`  - ${yamlQuote(p)}`);
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Directory initialization
// ---------------------------------------------------------------------------

/**
 * Ensure the .factory/ directory and subdirectories exist.
 */
export function ensureFactoryDir(projectPath: string): string {
  const factoryPath = join(projectPath, FACTORY_DIR);
  if (!existsSync(factoryPath)) mkdirSync(factoryPath, { recursive: true });

  const progressDir = join(factoryPath, FACTORY_FILES.PROGRESS_DIR);
  if (!existsSync(progressDir)) mkdirSync(progressDir, { recursive: true });

  const decisionsDir = join(factoryPath, FACTORY_FILES.DECISIONS_DIR);
  if (!existsSync(decisionsDir)) mkdirSync(decisionsDir, { recursive: true });

  const artifactsDir = join(factoryPath, FACTORY_FILES.ARTIFACTS_DIR);
  if (!existsSync(artifactsDir)) mkdirSync(artifactsDir, { recursive: true });

  return factoryPath;
}

// ---------------------------------------------------------------------------
// Write functions
// ---------------------------------------------------------------------------

export function writeConfig(projectPath: string, config: FactoryConfig): void {
  const factoryPath = ensureFactoryDir(projectPath);
  writeFileSync(join(factoryPath, FACTORY_FILES.CONFIG), configToYaml(config), "utf-8");
}

export function writeStatus(projectPath: string, status: FactoryStatus): void {
  const factoryPath = ensureFactoryDir(projectPath);
  writeFileSync(join(factoryPath, FACTORY_FILES.STATUS), JSON.stringify(status, null, 2), "utf-8");
}

export function writeQueue(projectPath: string, queue: WorkQueue): void {
  const factoryPath = ensureFactoryDir(projectPath);
  writeFileSync(join(factoryPath, FACTORY_FILES.QUEUE), JSON.stringify(queue, null, 2), "utf-8");
}

export function writeSyncStatus(projectPath: string, syncStatus: SyncStatus): void {
  const factoryPath = ensureFactoryDir(projectPath);
  writeFileSync(
    join(factoryPath, FACTORY_FILES.SYNC_STATUS),
    JSON.stringify(syncStatus, null, 2),
    "utf-8",
  );
}

export function writeSessionLog(projectPath: string, session: SessionLog): void {
  const factoryPath = ensureFactoryDir(projectPath);
  const progressDir = join(factoryPath, FACTORY_FILES.PROGRESS_DIR);
  const fileName = `${session.session_id}.json`;
  writeFileSync(join(progressDir, fileName), JSON.stringify(session, null, 2), "utf-8");
}

export function writeContextMd(projectPath: string, content: string): void {
  const factoryPath = ensureFactoryDir(projectPath);
  writeFileSync(join(factoryPath, FACTORY_FILES.CONTEXT), content, "utf-8");
}

export function writeClaudeMd(projectPath: string, content: string): void {
  const factoryPath = ensureFactoryDir(projectPath);
  writeFileSync(join(factoryPath, FACTORY_FILES.CLAUDE_MD), content, "utf-8");
}

export function writeSpecMd(projectPath: string, content: string): void {
  const factoryPath = ensureFactoryDir(projectPath);
  writeFileSync(join(factoryPath, FACTORY_FILES.SPEC), content, "utf-8");
}

// ---------------------------------------------------------------------------
// CLAUDE.md generation
// ---------------------------------------------------------------------------

interface ClaudeMdContext {
  config: FactoryConfig;
  specSummary?: string;
  contextContent?: string;
  queueItems?: Array<{ priority: string; title: string; description?: string }>;
  recentSessions?: Array<{ session_id: string; notes?: string; work_items_completed?: string[] }>;
}

/**
 * Generate CLAUDE.md content from project context.
 * This is auto-loaded by Claude Code when opening the project.
 */
export function generateClaudeMd(ctx: ClaudeMdContext): string {
  const lines: string[] = [];

  lines.push(`# ${ctx.config.display_name}`);
  lines.push("");
  lines.push(`## Project Context`);
  lines.push(`- **Type**: ${ctx.config.type}`);
  lines.push(`- **Trust Tier**: ${ctx.config.trust_tier}`);
  lines.push(`- **Phase**: ${ctx.config.phase}`);
  if (ctx.config.stack?.length) {
    lines.push(`- **Stack**: ${ctx.config.stack.join(", ")}`);
  }
  lines.push("");

  if (ctx.contextContent) {
    lines.push("## Domain Context");
    lines.push(ctx.contextContent);
    lines.push("");
  }

  if (ctx.specSummary) {
    lines.push("## Specification Summary");
    lines.push(ctx.specSummary);
    lines.push("");
  }

  if (ctx.queueItems?.length) {
    lines.push("## Work Queue (This Session)");
    for (const item of ctx.queueItems) {
      const prefix = item.priority === "high" ? "[HIGH]" : item.priority === "medium" ? "[MED]" : "[LOW]";
      lines.push(`- ${prefix} ${item.title}`);
      if (item.description) lines.push(`  ${item.description}`);
    }
    lines.push("");
  }

  if (ctx.recentSessions?.length) {
    lines.push("## Recent Sessions");
    for (const s of ctx.recentSessions.slice(0, 3)) {
      lines.push(`- **${s.session_id}**: ${s.notes || "No notes"}`);
      if (s.work_items_completed?.length) {
        lines.push(`  Completed: ${s.work_items_completed.join(", ")}`);
      }
    }
    lines.push("");
  }

  // Methodology rules based on trust tier
  lines.push("## Methodology Rules");
  lines.push(`- Trust Tier ${ctx.config.trust_tier}: ${getTierRules(ctx.config.trust_tier)}`);
  lines.push("- Run behavioral scenarios after completing each work item");
  lines.push("- Log decisions to .factory/decisions/ when making architecture choices");
  lines.push("- Write session progress to .factory/progress/ at session end");
  lines.push(`- Escalate when: ${getEscalationRules(ctx.config.trust_tier)}`);
  lines.push("");

  return lines.join("\n");
}

function getTierRules(tier: number): string {
  switch (tier) {
    case 1:
      return "Low risk. Base scenarios only. Autonomous execution OK.";
    case 2:
      return "Moderate risk. Validate against spec before shipping. 2 variations per scenario.";
    case 3:
      return "Legal/financial risk. Intent contract required. Human review on all PRs. 3+ variations.";
    case 4:
      return "Irreversible harm possible. Domain expert must review. Full eval stack. Never ship without human sign-off.";
    default:
      return "Unknown tier.";
  }
}

function getEscalationRules(tier: number): string {
  switch (tier) {
    case 1:
      return "Spec ambiguity found, external dependency blocked";
    case 2:
      return "Spec ambiguity, trust boundary hit, blocked dependency, data model changes";
    case 3:
      return "Any decision with legal/financial implications, spec ambiguity, intent contract conflict";
    case 4:
      return "All significant decisions. When in doubt, escalate.";
    default:
      return "When in doubt, escalate.";
  }
}

// ---------------------------------------------------------------------------
// Initialize a new .factory/ directory
// ---------------------------------------------------------------------------

/**
 * Regenerate .factory/CLAUDE.md from the current on-disk state.
 *
 * Throws if the project has no .factory/config.yaml — there's nothing to
 * generate from in that case. Returns the generated content so the caller
 * can surface it without a follow-up read.
 */
export function regenerateClaudeMd(projectPath: string): string {
  const directory = readFactoryDirectory(projectPath);
  if (!directory.exists || !directory.config) {
    throw new Error(
      `Cannot regenerate CLAUDE.md: no .factory/config.yaml at ${projectPath}`,
    );
  }

  const queueItems = directory.queue?.items
    .filter((item) => item.status !== "done")
    .slice(0, 20)
    .map((item) => ({
      priority: item.priority,
      title: item.title,
      ...(item.description !== undefined ? { description: item.description } : {}),
    }));

  const recentSessions = directory.sessions.slice(0, 3).map((session) => ({
    session_id: session.session_id,
    ...(session.notes !== undefined ? { notes: session.notes } : {}),
    ...(session.work_items_completed !== undefined
      ? { work_items_completed: [...session.work_items_completed] }
      : {}),
  }));

  const content = generateClaudeMd({
    config: directory.config,
    ...(directory.contextContent !== null ? { contextContent: directory.contextContent } : {}),
    ...(queueItems && queueItems.length > 0 ? { queueItems } : {}),
    ...(recentSessions.length > 0 ? { recentSessions } : {}),
  });

  writeClaudeMd(projectPath, content);
  return content;
}

/**
 * Initialize a new `.factory/` directory. Idempotent: existing files are
 * not overwritten so intake of a path that was already initialized (by
 * another Attacca instance, or the CLI) does not clobber user edits.
 * Only creates files that are *missing*.
 */
export function initializeFactory(
  projectPath: string,
  config: FactoryConfig,
): void {
  const factoryPath = ensureFactoryDir(projectPath);

  const configPath = join(factoryPath, FACTORY_FILES.CONFIG);
  if (!existsSync(configPath)) {
    writeConfig(projectPath, { ...config, version: FACTORY_PROTOCOL_VERSION });
  }

  const statusPath = join(factoryPath, FACTORY_FILES.STATUS);
  if (!existsSync(statusPath)) {
    const status: FactoryStatus = {
      state: config.phase,
      health: "active",
      track: config.track,
      archived: false,
      completion_pct: 0,
      gap_count: 0,
      last_activity: new Date().toISOString(),
      assigned_dev: config.assigned_dev,
    };
    writeStatus(projectPath, status);
  }

  const contextPath = join(factoryPath, FACTORY_FILES.CONTEXT);
  if (!existsSync(contextPath)) {
    const contextContent = `# ${config.display_name} — Project Context\n\n## Architecture\n\n(Add architecture notes here)\n\n## Domain Notes\n\n(Add domain-specific context here)\n\n## Gotchas\n\n(Add known issues and workarounds here)\n`;
    writeContextMd(projectPath, contextContent);
  }

  const claudeMdPath = join(factoryPath, FACTORY_FILES.CLAUDE_MD);
  if (!existsSync(claudeMdPath)) {
    const readConfig = existsSync(configPath);
    const usedConfig = readConfig
      ? ({ ...config, version: FACTORY_PROTOCOL_VERSION } as FactoryConfig)
      : config;
    const claudeMd = generateClaudeMd({ config: usedConfig });
    writeClaudeMd(projectPath, claudeMd);
  }
}
