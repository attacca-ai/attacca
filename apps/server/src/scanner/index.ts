/**
 * Project Scanner
 *
 * Discovers projects by scanning a root directory for .factory/ directories.
 * Adapted from dark-factory-command-center/src/lib/scanner.ts.
 * Used by Podium for the project dashboard.
 */

import { readdirSync, readFileSync, lstatSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { hasFactoryDir, readFactorySummary } from "../factory";
import { analyzeGaps } from "./gaps";
import {
  FACTORY_DIR,
  FACTORY_FILES,
  type FactoryConfig,
  type FactoryStatus,
  type Gap,
  type Health,
  type Phase,
  type ProjectTrack,
  type ScannedProject,
  type WorkQueue,
} from "@t3tools/contracts";

function readQueueFile(projectPath: string): WorkQueue | null {
  const queuePath = join(projectPath, FACTORY_DIR, FACTORY_FILES.QUEUE);
  if (!existsSync(queuePath)) return null;
  try {
    return JSON.parse(readFileSync(queuePath, "utf-8")) as WorkQueue;
  } catch {
    return null;
  }
}

const DEFAULT_EXCLUDE = [
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "attacca", // Don't scan ourselves
] as const;

function buildExcludeSet(): Set<string> {
  const set = new Set<string>(DEFAULT_EXCLUDE);
  const extra = process.env.ATTACCA_PODIUM_EXCLUDE;
  if (extra) {
    for (const name of extra.split(",")) {
      const trimmed = name.trim();
      if (trimmed.length > 0) set.add(trimmed);
    }
  }
  return set;
}

export type { ScannedProject };

export interface ScanProjectsDetailedResult {
  readonly projects: ReadonlyArray<ScannedProject>;
  readonly warning: string | null;
}

function describeRootScanFailure(rootDir: string, cause?: unknown): string {
  if (!cause) {
    return `Could not scan ${rootDir} (directory not found).`;
  }
  const error = cause as NodeJS.ErrnoException;
  switch (error.code) {
    case "ENOENT":
      return `Could not scan ${rootDir} (directory not found).`;
    case "EACCES":
    case "EPERM":
      return `Could not scan ${rootDir} (permission denied).`;
    default:
      return `Could not scan ${rootDir}${error.message ? ` (${error.message})` : ""}.`;
  }
}

/**
 * Infer basic project state from filesystem when no .factory/ exists.
 */
function inferState(projectPath: string): { phase: Phase; track: ProjectTrack } {
  const hasPackageJson = existsSync(join(projectPath, "package.json"));
  const hasSrc = existsSync(join(projectPath, "src"));
  const hasGit = existsSync(join(projectPath, ".git"));

  if (hasPackageJson && hasSrc && hasGit) {
    return { phase: "BUILD" as Phase, track: "software" as ProjectTrack };
  }
  if (hasPackageJson) {
    return { phase: "SPEC" as Phase, track: "software" as ProjectTrack };
  }
  return { phase: "IDEA" as Phase, track: "software" as ProjectTrack };
}

/**
 * Convert .factory/ data into a ScannedProject.
 */
function fromFactory(
  projectPath: string,
  slug: string,
  config: FactoryConfig | null,
  status: FactoryStatus | null,
  queue: WorkQueue | null,
): ScannedProject {
  const inferred = inferState(projectPath);
  const gaps: Gap[] = analyzeGaps(projectPath, config, status, queue);

  return {
    slug,
    displayName: config?.display_name ?? slug,
    path: projectPath,
    hasFactory: true,
    phase: config?.phase ?? status?.state ?? inferred.phase,
    health: (status?.health as Health) ?? "active",
    track: config?.track ?? status?.track ?? inferred.track,
    trustTier: config?.trust_tier ?? 2,
    completionPct: status?.completion_pct ?? 0,
    gapCount: gaps.length,
    gaps,
    assignedDev: config?.assigned_dev ?? status?.assigned_dev ?? null,
    nextAction: status?.next_action ?? null,
    lastActivity: status?.last_activity ?? null,
    repo: config?.repo ?? null,
    stack: config?.stack ? [...config.stack] : [],
  } satisfies ScannedProject;
}

export function scanProjectsDetailed(rootDir: string): ScanProjectsDetailedResult {
  if (!existsSync(rootDir)) {
    return { projects: [], warning: describeRootScanFailure(rootDir) };
  }

  try {
    readdirSync(rootDir);
  } catch (cause) {
    return { projects: [], warning: describeRootScanFailure(rootDir, cause) };
  }

  return {
    projects: scanProjects(rootDir),
    warning: null,
  };
}

/**
 * Scan a root directory for projects.
 * Returns all directories with .factory/ first, then other projects.
 */
export function scanProjects(rootDir: string): ScannedProject[] {
  if (!existsSync(rootDir)) return [];

  const exclude = buildExcludeSet();
  let entries: string[];
  try {
    entries = readdirSync(rootDir);
  } catch {
    // Permission denied, race with a directory delete, or any other
    // readdir failure — return empty rather than bubble up as an error.
    // The empty state is the calm UX per scenario 7; an error modal is not.
    return [];
  }
  const projects: ScannedProject[] = [];

  for (const entry of entries) {
    if (exclude.has(entry)) continue;
    if (entry.startsWith(".")) continue;

    const fullPath = join(rootDir, entry);
    try {
      const stat = lstatSync(fullPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    } catch {
      continue;
    }

    const slug = basename(fullPath);

    if (hasFactoryDir(fullPath)) {
      const { config, status } = readFactorySummary(fullPath);
      const queue = readQueueFile(fullPath);
      projects.push(fromFactory(fullPath, slug, config, status, queue));
    } else {
      // Include non-factory projects with inferred state
      const inferred = inferState(fullPath);
      projects.push({
        slug,
        displayName: slug,
        path: fullPath,
        hasFactory: false,
        phase: inferred.phase,
        health: "active",
        track: inferred.track,
        trustTier: 2,
        completionPct: 0,
        gapCount: 0,
        gaps: [],
        assignedDev: null,
        nextAction: null,
        lastActivity: null,
        repo: null,
        stack: [],
      });
    }
  }

  // Sort: factory projects first, then by name
  return projects.sort((a, b) => {
    if (a.hasFactory && !b.hasFactory) return -1;
    if (!a.hasFactory && b.hasFactory) return 1;
    return a.slug.localeCompare(b.slug);
  });
}
