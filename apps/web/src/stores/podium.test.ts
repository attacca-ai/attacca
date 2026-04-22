import {
  EnvironmentId,
  ProjectId,
  type ScannedProject,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  factory: {
    getPodiumRoot: vi.fn(),
    scanProjects: vi.fn(),
    readSummary: vi.fn(),
    initialize: vi.fn(),
  },
  git: {
    cloneRepository: vi.fn(),
  },
}));

vi.mock("../rpc/wsRpcClient", () => ({
  getWsRpcClient: () => mockClient,
}));

import { buildIntakePresetPrompt, partitionDiscoveredProjects, usePodiumStore } from "./podium";

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
    mockClient.factory.readSummary.mockReset();
    mockClient.factory.initialize.mockReset();
    mockClient.git.cloneRepository.mockReset();
    mockClient.factory.readSummary.mockResolvedValue({
      config: {
        version: 1,
        name: "acme-api",
        display_name: "acme-api",
        type: "greenfield",
        trust_tier: 2,
        phase: "IDEA",
        track: "software",
      },
      status: null,
    });
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

  it("requests server-side type auto-detection during external intake", async () => {
    mockClient.factory.initialize.mockResolvedValue(undefined);
    mockClient.factory.readSummary.mockResolvedValue({
      config: {
        version: 1,
        name: "acme-api",
        display_name: "acme-api",
        type: "brownfield",
        trust_tier: 2,
        phase: "IDEA",
        track: "software",
      },
      status: null,
    });
    const handleNewThread = vi.fn().mockResolvedValue(undefined);
    const dispatchProjectCreate = vi.fn().mockResolvedValue(undefined);
    const updateSettings = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);
    const fakeProjectRef = {} as ScopedProjectRef;

    await usePodiumStore.getState().intakeProjectFromPath("D:/repos/acme-api", {
      orchestrationProjects: [],
      activeEnvironmentId: EnvironmentId.make("environment-local"),
      dispatchProjectCreate,
      handleNewThread,
      externalIntakeRoots: ["D:/repos"],
      podiumScanRoot: "C:/primary",
      updateSettings,
      defaultThreadEnvMode: "local",
      confirm,
      scopeProjectRef: () => fakeProjectRef,
      newProjectId: () => ProjectId.make("project-acme-api"),
    });

    expect(dispatchProjectCreate).toHaveBeenCalledWith({
      projectId: "project-acme-api",
      title: "acme-api",
      workspaceRoot: "D:/repos/acme-api",
    });
    expect(mockClient.factory.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "D:/repos/acme-api",
        autoDetectType: true,
      }),
    );
    expect(handleNewThread).toHaveBeenCalledWith(fakeProjectRef, {
      envMode: "local",
      presetPrompt: buildIntakePresetPrompt("acme-api", "brownfield"),
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("initializes an already-registered project when .factory metadata is missing", async () => {
    mockClient.factory.initialize.mockResolvedValue(undefined);
    mockClient.factory.readSummary
      .mockResolvedValueOnce({
        config: null,
        status: null,
      })
      .mockResolvedValueOnce({
        config: {
          version: 1,
          name: "legacy-app",
          display_name: "legacy-app",
          type: "greenfield",
          trust_tier: 2,
          phase: "IDEA",
          track: "software",
        },
        status: null,
      });
    const handleNewThread = vi.fn().mockResolvedValue(undefined);
    const dispatchProjectCreate = vi.fn().mockResolvedValue(undefined);
    const updateSettings = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);
    const fakeProjectRef = {} as ScopedProjectRef;

    await usePodiumStore.getState().intakeProjectFromPath("D:/repos/legacy-app", {
      orchestrationProjects: [
        {
          environmentId: EnvironmentId.make("environment-local"),
          id: ProjectId.make("project-legacy-app"),
          cwd: "D:/repos/legacy-app",
        },
      ],
      activeEnvironmentId: EnvironmentId.make("environment-local"),
      dispatchProjectCreate,
      handleNewThread,
      externalIntakeRoots: ["D:/repos"],
      podiumScanRoot: "C:/primary",
      updateSettings,
      defaultThreadEnvMode: "local",
      confirm,
      scopeProjectRef: () => fakeProjectRef,
      newProjectId: () => ProjectId.make("project-unused"),
    });

    expect(dispatchProjectCreate).not.toHaveBeenCalled();
    expect(mockClient.factory.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "D:/repos/legacy-app",
        autoDetectType: true,
      }),
    );
    expect(handleNewThread).toHaveBeenCalledWith(fakeProjectRef, {
      envMode: "local",
      presetPrompt: buildIntakePresetPrompt("legacy-app", "greenfield"),
    });
  });

  it("clones a Git URL into the Podium root before reusing path intake", async () => {
    mockClient.git.cloneRepository.mockResolvedValue({
      directoryName: "widget-service",
      projectPath: "C:/primary/widget-service",
    });
    mockClient.factory.initialize.mockResolvedValue(undefined);
    mockClient.factory.readSummary
      .mockResolvedValueOnce({
        config: null,
        status: null,
      })
      .mockResolvedValueOnce({
        config: {
          version: 1,
          name: "widget-service",
          display_name: "widget-service",
          type: "brownfield",
          trust_tier: 2,
          phase: "IDEA",
          track: "software",
        },
        status: null,
      });
    const handleNewThread = vi.fn().mockResolvedValue(undefined);
    const dispatchProjectCreate = vi.fn().mockResolvedValue(undefined);
    const updateSettings = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);
    const fakeProjectRef = {} as ScopedProjectRef;

    await usePodiumStore.getState().intakeProjectFromGitUrl("https://github.com/acme/widget.git", {
      orchestrationProjects: [],
      activeEnvironmentId: EnvironmentId.make("environment-local"),
      dispatchProjectCreate,
      handleNewThread,
      externalIntakeRoots: ["D:/repos"],
      podiumScanRoot: "C:/primary",
      updateSettings,
      defaultThreadEnvMode: "local",
      confirm,
      scopeProjectRef: () => fakeProjectRef,
      newProjectId: () => ProjectId.make("project-widget-service"),
    });

    expect(mockClient.git.cloneRepository).toHaveBeenCalledWith({
      url: "https://github.com/acme/widget.git",
      destinationParent: "C:/primary",
      allowedRoots: ["D:/repos", "C:/primary"],
    });
    expect(dispatchProjectCreate).toHaveBeenCalledWith({
      projectId: "project-widget-service",
      title: "widget-service",
      workspaceRoot: "C:/primary/widget-service",
    });
    expect(mockClient.factory.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "C:/primary/widget-service",
        autoDetectType: true,
      }),
    );
    expect(handleNewThread).toHaveBeenCalledWith(fakeProjectRef, {
      envMode: "local",
      presetPrompt: buildIntakePresetPrompt("widget-service", "brownfield"),
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });
});

describe("partitionDiscoveredProjects", () => {
  it("splits discovered projects into visible and dismissed lists by normalized path", () => {
    const acme = makeScannedProject({
      path: "C:/Projects/Acme",
      slug: "Acme",
      hasFactory: false,
    });
    const widget = makeScannedProject({
      path: "C:/Projects/widget",
      slug: "widget",
      hasFactory: false,
    });

    const result = partitionDiscoveredProjects([widget, acme], ["c:\\projects\\acme\\"]);

    expect(result.visibleProjects.map((project) => project.path)).toEqual(["C:/Projects/widget"]);
    expect(result.dismissedProjects.map((project) => project.path)).toEqual(["C:/Projects/Acme"]);
  });
});
