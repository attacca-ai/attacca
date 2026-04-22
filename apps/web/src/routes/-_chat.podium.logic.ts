import type { ScannedProject } from "@t3tools/contracts";

export const DISCOVERED_PROJECTS_PREVIEW_LIMIT = 50;

export function resolveProjectListPreview(
  projects: ReadonlyArray<ScannedProject>,
  expanded: boolean,
  limit = DISCOVERED_PROJECTS_PREVIEW_LIMIT,
): {
  readonly visibleProjects: ReadonlyArray<ScannedProject>;
  readonly hiddenCount: number;
  readonly totalCount: number;
} {
  if (expanded || projects.length <= limit) {
    return {
      visibleProjects: projects,
      hiddenCount: 0,
      totalCount: projects.length,
    };
  }

  return {
    visibleProjects: projects.slice(0, limit),
    hiddenCount: Math.max(0, projects.length - limit),
    totalCount: projects.length,
  };
}
