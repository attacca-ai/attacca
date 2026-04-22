import {
  FACTORY_PROTOCOL_VERSION,
  type FactoryConfig,
  type FactoryDirectory,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  factory: {
    initialize: vi.fn(),
    read: vi.fn(),
  },
}));

vi.mock("../rpc/wsRpcClient", () => ({
  getWsRpcClient: () => mockClient,
}));

import { useFactoryStore } from "./factory";

const baseConfig: FactoryConfig = {
  version: FACTORY_PROTOCOL_VERSION,
  name: "acme-api",
  display_name: "acme-api",
  type: "greenfield",
  trust_tier: 2,
  phase: "IDEA",
  track: "software",
};

const baseDirectory: FactoryDirectory = {
  exists: true,
  path: "/tmp/acme-api/.factory",
  config: baseConfig,
  status: null,
  queue: null,
  syncStatus: null,
  specContent: null,
  contextContent: null,
  intentContract: null,
  scenarios: null,
  sessions: [],
  claudeMd: null,
};

function resetFactoryStore() {
  useFactoryStore.setState({
    activeProjectPath: null,
    entries: {},
    forgeSkills: {
      status: "idle",
      skills: [],
      error: null,
      loadedAt: null,
      source: null,
    },
    activeSessionsByProjectPath: {},
  });
}

describe("factory store initializeFactory", () => {
  beforeEach(() => {
    resetFactoryStore();
    mockClient.factory.initialize.mockReset();
    mockClient.factory.read.mockReset();
    mockClient.factory.initialize.mockResolvedValue(undefined);
    mockClient.factory.read.mockResolvedValue(baseDirectory);
  });

  it("forwards auto-detect requests to the initialize RPC", async () => {
    await useFactoryStore.getState().initializeFactory("/tmp/acme-api", baseConfig, undefined, {
      autoDetectType: true,
    });

    expect(mockClient.factory.initialize).toHaveBeenCalledWith({
      projectPath: "/tmp/acme-api",
      config: baseConfig,
      allowedRoots: undefined,
      autoDetectType: true,
    });
  });
});
