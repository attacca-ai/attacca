import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type DesktopBridge,
  type DesktopUpdateState,
  type LocalApi,
  type ServerConfig,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { GeneralSettingsPanel } from "./SettingsPanels";

function createBaseServerConfig(): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.makeUnsafe("environment-local"),
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

const createDesktopBridgeStub = (overrides?: {
  readonly serverExposureState?: Awaited<ReturnType<DesktopBridge["getServerExposureState"]>>;
}): DesktopBridge => {
  const idleUpdateState: DesktopUpdateState = {
    enabled: false,
    status: "idle",
    currentVersion: "0.0.0-test",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };

  return {
    getWsUrl: () => null,
    getLocalEnvironmentBootstrap: () => ({
      label: "Local environment",
      wsUrl: "ws://127.0.0.1:3773/ws",
      bootstrapToken: "desktop-bootstrap-token",
    }),
    getServerExposureState: vi.fn().mockResolvedValue(
      overrides?.serverExposureState ?? {
        mode: "local-only",
        endpointUrl: null,
        advertisedHost: null,
      },
    ),
    setServerExposureMode: vi.fn().mockImplementation(async (mode) => ({
      mode,
      endpointUrl: mode === "network-accessible" ? "http://192.168.1.44:3773" : null,
      advertisedHost: mode === "network-accessible" ? "192.168.1.44" : null,
    })),
    pickFolder: vi.fn().mockResolvedValue(null),
    confirm: vi.fn().mockResolvedValue(false),
    setTheme: vi.fn().mockResolvedValue(undefined),
    showContextMenu: vi.fn().mockResolvedValue(null),
    openExternal: vi.fn().mockResolvedValue(true),
    onMenuAction: () => () => {},
    getUpdateState: vi.fn().mockResolvedValue(idleUpdateState),
    checkForUpdate: vi.fn().mockResolvedValue({ checked: false, state: idleUpdateState }),
    downloadUpdate: vi
      .fn()
      .mockResolvedValue({ accepted: false, completed: false, state: idleUpdateState }),
    installUpdate: vi
      .fn()
      .mockResolvedValue({ accepted: false, completed: false, state: idleUpdateState }),
    onUpdateState: () => () => {},
  };
};

describe("GeneralSettingsPanel observability", () => {
  beforeEach(async () => {
    resetServerStateForTests();
    await __resetLocalApiForTests();
    localStorage.clear();
  });

  afterEach(async () => {
    resetServerStateForTests();
    await __resetLocalApiForTests();
  });

  it("shows diagnostics inside About with a single logs-folder action", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect.element(page.getByText("Diagnostics")).toBeInTheDocument();
    await expect.element(page.getByText("Open logs folder")).toBeInTheDocument();
    await expect
      .element(page.getByText("/repo/project/.t3/logs", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Local trace file. OTLP exporting traces to http://localhost:4318/v1/traces.",
        ),
      )
      .toBeInTheDocument();
  });

  it("creates and shows a pairing link when network access is enabled", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "network-accessible",
        endpointUrl: "http://192.168.1.44:3773",
        advertisedHost: "192.168.1.44",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            credential: "pairing-token",
            expiresAt: "2026-04-05T00:00:00.000Z",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Network access")).toBeInTheDocument();
    await expect.element(page.getByText("Pair another client")).toBeInTheDocument();
    await page.getByText("Create link", { exact: true }).click();
    await expect
      .element(page.getByText("http://192.168.1.44:3773/pair?token=pairing-token"))
      .toBeInTheDocument();
    await expect.element(page.getByText("Copy URL", { exact: true })).toBeInTheDocument();
  });

  it("confirms before restarting to change network access", async () => {
    let resolveSetServerExposureMode:
      | ((value: Awaited<ReturnType<DesktopBridge["setServerExposureMode"]>>) => void)
      | null = null;
    const setServerExposureMode = vi
      .fn<DesktopBridge["setServerExposureMode"]>()
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSetServerExposureMode = resolve;
          }),
      );
    window.desktopBridge = {
      ...createDesktopBridgeStub(),
      setServerExposureMode,
    };

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByLabelText("Enable network access").click();

    expect(setServerExposureMode).not.toHaveBeenCalled();
    await expect.element(page.getByText("Enable network access?")).toBeInTheDocument();
    await expect
      .element(page.getByText("T3 Code will restart to expose this environment over the network."))
      .toBeInTheDocument();

    await page.getByText("Restart and enable").click();

    expect(setServerExposureMode).toHaveBeenCalledWith("network-accessible");
    await expect.element(page.getByText("Restarting…")).toBeInTheDocument();
    await expect.element(page.getByText("Enable network access?")).toBeInTheDocument();

    expect(resolveSetServerExposureMode).toBeTypeOf("function");
    resolveSetServerExposureMode!({
      mode: "network-accessible",
      endpointUrl: null,
      advertisedHost: null,
    });
  });

  it("opens the logs folder in the preferred editor", async () => {
    const openInEditor = vi.fn<LocalApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
    window.nativeApi = {
      shell: {
        openInEditor,
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const openLogsButton = page.getByText("Open logs folder");
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith("/repo/project/.t3/logs", "cursor");
  });
});
