import { afterEach, beforeEach, describe, assert, expect, it, vi } from "vitest";

const { resolvePrimaryEnvironmentBootstrapUrlMock } = vi.hoisted(() => ({
  resolvePrimaryEnvironmentBootstrapUrlMock: vi.fn(() => "http://bootstrap.test:4321"),
}));

vi.mock("../environmentBootstrap", () => ({
  resolvePrimaryEnvironmentBootstrapUrl: resolvePrimaryEnvironmentBootstrapUrlMock,
}));

import { isWindowsPlatform, resolveServerHttpUrl, resolveServerUrl } from "./utils";

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    assert.isTrue(isWindowsPlatform("Win32"));
    assert.isTrue(isWindowsPlatform("Windows"));
    assert.isTrue(isWindowsPlatform("windows_nt"));
  });

  it("does not match darwin", () => {
    assert.isFalse(isWindowsPlatform("darwin"));
  });
});

const originalWindow = globalThis.window;

beforeEach(() => {
  resolvePrimaryEnvironmentBootstrapUrlMock.mockReset();
  resolvePrimaryEnvironmentBootstrapUrlMock.mockReturnValue("http://bootstrap.test:4321");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "http://localhost:5735",
        hostname: "localhost",
        port: "5735",
        protocol: "http:",
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("resolveServerHttpUrl", () => {
  it("uses the Vite dev origin for local HTTP requests automatically", () => {
    vi.stubEnv("VITE_WS_URL", "ws://127.0.0.1:3775/ws");

    assert.equal(
      resolveServerHttpUrl({ pathname: "/api/observability/v1/traces" }),
      "http://localhost:5735/api/observability/v1/traces",
    );
  });
});

describe("resolveServerUrl", () => {
  it("falls back to the bootstrap environment URL when the explicit URL is empty", () => {
    expect(resolveServerUrl({ url: "" })).toBe("http://bootstrap.test:4321/");
  });

  it("uses the bootstrap environment URL when no explicit URL is provided", () => {
    expect(resolveServerUrl()).toBe("http://bootstrap.test:4321/");
  });

  it("prefers an explicit URL override", () => {
    expect(
      resolveServerUrl({
        url: "https://override.test:9999",
        protocol: "wss",
        pathname: "/rpc",
        searchParams: { hello: "world" },
      }),
    ).toBe("wss://override.test:9999/rpc?hello=world");
  });

  it("does not evaluate the bootstrap resolver when an explicit URL is provided", () => {
    resolvePrimaryEnvironmentBootstrapUrlMock.mockImplementationOnce(() => {
      throw new Error("bootstrap unavailable");
    });

    expect(resolveServerUrl({ url: "https://override.test:9999" })).toBe(
      "https://override.test:9999/",
    );
  });

  it("keeps the backend origin for websocket requests", () => {
    vi.stubEnv("VITE_WS_URL", "ws://127.0.0.1:3775/ws");

    assert.equal(
      resolveServerUrl({
        protocol: "ws",
        pathname: "/ws",
      }),
      "ws://127.0.0.1:3775/ws",
    );
  });
});
