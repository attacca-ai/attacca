import { describe, expect, it } from "vitest";
import type { ScannedProject } from "@t3tools/contracts";

import {
  DISCOVERED_PROJECTS_PREVIEW_LIMIT,
  resolveProjectListPreview,
} from "./-_chat.podium.logic";

function makeScannedProject(path: string): ScannedProject {
  const slug = path.split("/").at(-1) ?? "project";
  return {
    slug,
    displayName: slug,
    path,
    hasFactory: false,
    phase: "BUILD",
    health: "active",
    track: "software",
    trustTier: 2,
    completionPct: 0,
    gapCount: 0,
    gaps: [],
    assignedDev: null,
    nextAction: null,
    lastActivity: null,
    repo: null,
    stack: [],
  };
}

describe("-_chat.podium.logic", () => {
  it("caps long lists when collapsed", () => {
    const projects = Array.from({ length: DISCOVERED_PROJECTS_PREVIEW_LIMIT + 7 }, (_, index) =>
      makeScannedProject(`C:/projects/project-${index}`),
    );

    const result = resolveProjectListPreview(projects, false);

    expect(result.visibleProjects).toHaveLength(DISCOVERED_PROJECTS_PREVIEW_LIMIT);
    expect(result.hiddenCount).toBe(7);
    expect(result.totalCount).toBe(projects.length);
  });

  it("shows the full list when expanded", () => {
    const projects = Array.from({ length: DISCOVERED_PROJECTS_PREVIEW_LIMIT + 3 }, (_, index) =>
      makeScannedProject(`C:/projects/project-${index}`),
    );

    const result = resolveProjectListPreview(projects, true);

    expect(result.visibleProjects).toHaveLength(projects.length);
    expect(result.hiddenCount).toBe(0);
  });
});
