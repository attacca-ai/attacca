/**
 * Project Scanner
 *
 * Discovers projects by scanning a root directory for .factory/ directories.
 * Adapted from dark-factory-command-center/src/lib/scanner.ts.
 * Used by Podium for the project dashboard.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { hasFactoryDir, readFactorySummary } from "../factory";
import type {
  FactoryConfig,
  FactoryStatus,
  Health,
  Phase,
  ProjectTrack,
  ScannedProject,
} from "@t3tools/contracts";

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
): ScannedProject {
  const inferred = inferState(projectPath);

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
    gapCount: status?.gap_count ?? 0,
    assignedDev: config?.assigned_dev ?? status?.assigned_dev ?? null,
    nextAction: status?.next_action ?? null,
    lastActivity: status?.last_activity ?? null,
    repo: config?.repo ?? null,
    stack: config?.stack ? [...config.stack] : [],
  } satisfies ScannedProject;
}

/**
 * Scan a root directory for projects.
 * Returns all directories with .factory/ first, then other projects.
 */
export function scanProjects(rootDir: string): ScannedProject[] {
  if (!existsSync(rootDir)) return [];

  const exclude = buildExcludeSet();
  const entries = readdirSync(rootDir);
  const projects: ScannedProject[] = [];

  for (const entry of entries) {
    if (exclude.has(entry)) continue;
    if (entry.startsWith(".")) continue;

    const fullPath = join(rootDir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const slug = basename(fullPath);

    if (hasFactoryDir(fullPath)) {
      const { config, status } = readFactorySummary(fullPath);
      projects.push(fromFactory(fullPath, slug, config, status));
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
