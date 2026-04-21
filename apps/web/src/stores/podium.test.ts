import type { ScannedProject } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  factory: {
    getPodiumRoot: vi.fn(),
    scanProjects: vi.fn(),
  },
}));

vi.mock("../rpc/wsRpcClient", () => ({
  getWsRpcClient: () => mockClient,
}));

import { usePodiumStore } from "./podium";

function makeScannedProject(input: {
  path: string;
  slug?: string;
  hasFactory?: boolean;
}): ScannedProject {
  const slug = input.slug ?? input.path.split("/").at(-1) ?? "project";
  return {
    slug,
    displayName: slug,
    path: input.path,
    hasFactory: input.hasFactory ?? true,
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

function resetPodiumStore() {
  usePodiumStore.setState({
    rootDir: "",
    rootSource: null,
    status: "idle",
    projects: [],
    error: null,
    loadedAt: null,
    selectedProjectPath: null,
    scanRoots: [],
    scanWarnings: [],
    intakeStatus: "idle",
    intakeError: null,
  });
}

describe("podium store scan warnings", () => {
  beforeEach(() => {
    resetPodiumStore();
    mockClient.factory.getPodiumRoot.mockReset();
    mockClient.factory.scanProjects.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("collects primary, per-root, and rejected external scan warnings", async () => {
    mockClient.factory.getPodiumRoot.mockResolvedValue({
      rootDir: "C:/primary",
      source: "default",
    });
    mockClient.factory.scanProjects
      .mockResolvedValueOnce({
        rootDir: "C:/primary",
        projects: [makeScannedProject({ path: "C:/primary/app" })],
        warning: "Could not scan C:/primary-cache (permission denied).",
      })
      .mockResolvedValueOnce({
        rootDir: "D:/external",
        projects: [],
        warning: "Could not scan D:/external (directory not found).",
      })
      .mockRejectedValueOnce(new Error("offline"));

    const projects = await usePodiumStore.getState().scan({
      externalRoots: ["D:/external", "E:/offline"],
    });

    const state = usePodiumStore.getState();
    expect(projects.map((project) => project.path)).toEqual(["C:/primary/app"]);
    expect(state.scanWarnings).toEqual([
      "Could not scan C:/primary-cache (permission denied).",
      "Could not scan D:/external (directory not found).",
      "Could not scan E:/offline (offline).",
    ]);
    expect(state.scanRoots).toEqual(["C:/primary", "D:/external", "E:/offline"]);
  });
});
