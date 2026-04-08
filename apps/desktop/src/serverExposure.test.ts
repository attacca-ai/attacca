import { describe, expect, it } from "vitest";

import {
  resolveDesktopServerExposure,
  resolveDesktopServerExposureHostOptions,
  resolveLanAdvertisedHost,
  resolveLanAdvertisedHosts,
} from "./serverExposure";

describe("resolveLanAdvertisedHost", () => {
  it("prefers an explicit host override", () => {
    expect(
      resolveLanAdvertisedHost(
        {
          en0: [
            {
              address: "192.168.1.44",
              family: "IPv4",
              internal: false,
              netmask: "255.255.255.0",
              cidr: "192.168.1.44/24",
              mac: "00:00:00:00:00:00",
            },
          ],
        },
        "10.0.0.9",
      ),
    ).toBe("10.0.0.9");
  });

  it("returns the first usable non-internal IPv4 address", () => {
    expect(
      resolveLanAdvertisedHost(
        {
          lo0: [
            {
              address: "127.0.0.1",
              family: "IPv4",
              internal: true,
              netmask: "255.0.0.0",
              cidr: "127.0.0.1/8",
              mac: "00:00:00:00:00:00",
            },
          ],
          en0: [
            {
              address: "192.168.1.44",
              family: "IPv4",
              internal: false,
              netmask: "255.255.255.0",
              cidr: "192.168.1.44/24",
              mac: "00:00:00:00:00:00",
            },
          ],
        },
        undefined,
      ),
    ).toBe("192.168.1.44");
  });

  it("returns null when no usable network address is available", () => {
    expect(
      resolveLanAdvertisedHost(
        {
          lo0: [
            {
              address: "127.0.0.1",
              family: "IPv4",
              internal: true,
              netmask: "255.0.0.0",
              cidr: "127.0.0.1/8",
              mac: "00:00:00:00:00:00",
            },
          ],
        },
        undefined,
      ),
    ).toBeNull();
  });
});

describe("resolveLanAdvertisedHosts", () => {
  it("returns all usable non-internal IPv4 addresses with interface labels", () => {
    expect(
      resolveLanAdvertisedHosts({
        en0: [
          {
            address: "192.168.1.44",
            family: "IPv4",
            internal: false,
            netmask: "255.255.255.0",
            cidr: "192.168.1.44/24",
            mac: "00:00:00:00:00:00",
          },
        ],
        tailscale0: [
          {
            address: "100.64.0.12",
            family: "IPv4",
            internal: false,
            netmask: "255.255.255.255",
            cidr: "100.64.0.12/32",
            mac: "00:00:00:00:00:00",
          },
        ],
      }),
    ).toEqual([
      { host: "192.168.1.44", label: "192.168.1.44 (en0)", interfaceName: "en0" },
      { host: "100.64.0.12", label: "100.64.0.12 (tailscale0)", interfaceName: "tailscale0" },
    ]);
  });
});

describe("resolveDesktopServerExposure", () => {
  it("keeps the desktop server loopback-only when local-only mode is selected", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "local-only",
        port: 3773,
        networkInterfaces: {},
      }),
    ).toEqual({
      mode: "local-only",
      bindHost: "127.0.0.1",
      localHttpUrl: "http://127.0.0.1:3773",
      localWsUrl: "ws://127.0.0.1:3773",
      endpointUrl: null,
      advertisedHost: null,
      availableHosts: [{ host: "0.0.0.0", label: "Expose all interfaces (0.0.0.0)" }],
      selectedHost: "0.0.0.0",
    });
  });

  it("binds to the chosen concrete host in network-accessible mode", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "network-accessible",
        port: 3773,
        networkInterfaces: {
          en0: [
            {
              address: "192.168.1.44",
              family: "IPv4",
              internal: false,
              netmask: "255.255.255.0",
              cidr: "192.168.1.44/24",
              mac: "00:00:00:00:00:00",
            },
          ],
        },
        preferredHost: "100.64.0.12",
      }),
    ).toEqual({
      mode: "network-accessible",
      bindHost: "100.64.0.12",
      localHttpUrl: "http://127.0.0.1:3773",
      localWsUrl: "ws://127.0.0.1:3773",
      endpointUrl: "http://100.64.0.12:3773",
      advertisedHost: "100.64.0.12",
      availableHosts: [
        { host: "0.0.0.0", label: "Expose all interfaces (0.0.0.0)" },
        { host: "192.168.1.44", label: "192.168.1.44 (en0)", interfaceName: "en0" },
      ],
      selectedHost: "100.64.0.12",
    });
  });

  it("binds to all interfaces when expose-all is selected", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "network-accessible",
        port: 3773,
        networkInterfaces: {
          en0: [
            {
              address: "192.168.1.44",
              family: "IPv4",
              internal: false,
              netmask: "255.255.255.0",
              cidr: "192.168.1.44/24",
              mac: "00:00:00:00:00:00",
            },
          ],
        },
        preferredHost: "0.0.0.0",
      }),
    ).toEqual({
      mode: "network-accessible",
      bindHost: "0.0.0.0",
      localHttpUrl: "http://127.0.0.1:3773",
      localWsUrl: "ws://127.0.0.1:3773",
      endpointUrl: "http://192.168.1.44:3773",
      advertisedHost: "192.168.1.44",
      availableHosts: [
        { host: "0.0.0.0", label: "Expose all interfaces (0.0.0.0)" },
        { host: "192.168.1.44", label: "192.168.1.44 (en0)", interfaceName: "en0" },
      ],
      selectedHost: "0.0.0.0",
    });
  });

  it("still exposes all interfaces when no concrete LAN address is detected", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "network-accessible",
        port: 3773,
        networkInterfaces: {},
      }),
    ).toEqual({
      mode: "network-accessible",
      bindHost: "0.0.0.0",
      localHttpUrl: "http://127.0.0.1:3773",
      localWsUrl: "ws://127.0.0.1:3773",
      endpointUrl: null,
      advertisedHost: null,
      availableHosts: [{ host: "0.0.0.0", label: "Expose all interfaces (0.0.0.0)" }],
      selectedHost: "0.0.0.0",
    });
  });
});

describe("resolveDesktopServerExposureHostOptions", () => {
  it("prepends an expose-all option ahead of concrete interfaces", () => {
    expect(
      resolveDesktopServerExposureHostOptions({
        en0: [
          {
            address: "192.168.1.44",
            family: "IPv4",
            internal: false,
            netmask: "255.255.255.0",
            cidr: "192.168.1.44/24",
            mac: "00:00:00:00:00:00",
          },
        ],
      }),
    ).toEqual([
      { host: "0.0.0.0", label: "Expose all interfaces (0.0.0.0)" },
      { host: "192.168.1.44", label: "192.168.1.44 (en0)", interfaceName: "en0" },
    ]);
  });
});
