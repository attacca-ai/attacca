import type { NetworkInterfaceInfo } from "node:os";
import type {
  DesktopServerExposureHostOption,
  DesktopServerExposureMode,
} from "@t3tools/contracts";

const DESKTOP_LOOPBACK_HOST = "127.0.0.1";
const DESKTOP_LAN_BIND_HOST = "0.0.0.0";
const EXPOSE_ALL_LABEL = "Expose all interfaces (0.0.0.0)";

export interface DesktopServerExposure {
  readonly mode: DesktopServerExposureMode;
  readonly bindHost: string;
  readonly localHttpUrl: string;
  readonly localWsUrl: string;
  readonly endpointUrl: string | null;
  readonly advertisedHost: string | null;
  readonly availableHosts: readonly DesktopServerExposureHostOption[];
  readonly selectedHost: string | null;
}

const normalizeOptionalHost = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const isUsableLanIpv4Address = (address: string): boolean =>
  !address.startsWith("127.") && !address.startsWith("169.254.");

export function resolveLanAdvertisedHost(
  networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  explicitHost: string | undefined,
): string | null {
  const normalizedExplicitHost = normalizeOptionalHost(explicitHost);
  if (normalizedExplicitHost) {
    return normalizedExplicitHost;
  }

  for (const interfaceAddresses of Object.values(networkInterfaces)) {
    if (!interfaceAddresses) continue;

    for (const address of interfaceAddresses) {
      if (address.internal) continue;
      if (address.family !== "IPv4") continue;
      if (!isUsableLanIpv4Address(address.address)) continue;
      return address.address;
    }
  }

  return null;
}

export function resolveLanAdvertisedHosts(
  networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): readonly DesktopServerExposureHostOption[] {
  const hosts: DesktopServerExposureHostOption[] = [];
  const seenHosts = new Set<string>();

  for (const [interfaceName, interfaceAddresses] of Object.entries(networkInterfaces)) {
    if (!interfaceAddresses) continue;

    for (const address of interfaceAddresses) {
      if (address.internal) continue;
      if (address.family !== "IPv4") continue;
      if (!isUsableLanIpv4Address(address.address)) continue;
      if (seenHosts.has(address.address)) continue;
      seenHosts.add(address.address);
      hosts.push({
        host: address.address,
        label: interfaceName ? `${address.address} (${interfaceName})` : address.address,
        ...(interfaceName ? { interfaceName } : {}),
      });
    }
  }

  return hosts;
}

export function resolveDesktopServerExposureHostOptions(
  networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): readonly DesktopServerExposureHostOption[] {
  return [
    {
      host: DESKTOP_LAN_BIND_HOST,
      label: EXPOSE_ALL_LABEL,
    },
    ...resolveLanAdvertisedHosts(networkInterfaces),
  ];
}

export function resolveDesktopServerExposure(input: {
  readonly mode: DesktopServerExposureMode;
  readonly port: number;
  readonly networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
  readonly preferredHost?: string;
}): DesktopServerExposure {
  const localHttpUrl = `http://${DESKTOP_LOOPBACK_HOST}:${input.port}`;
  const localWsUrl = `ws://${DESKTOP_LOOPBACK_HOST}:${input.port}`;
  const concreteHosts = resolveLanAdvertisedHosts(input.networkInterfaces);
  const availableHosts = resolveDesktopServerExposureHostOptions(input.networkInterfaces);
  const selectedHost =
    normalizeOptionalHost(input.preferredHost) ?? concreteHosts[0]?.host ?? DESKTOP_LAN_BIND_HOST;

  if (input.mode === "local-only") {
    return {
      mode: input.mode,
      bindHost: DESKTOP_LOOPBACK_HOST,
      localHttpUrl,
      localWsUrl,
      endpointUrl: null,
      advertisedHost: null,
      availableHosts,
      selectedHost,
    };
  }

  if (selectedHost === DESKTOP_LAN_BIND_HOST) {
    return {
      mode: input.mode,
      bindHost: DESKTOP_LAN_BIND_HOST,
      localHttpUrl,
      localWsUrl,
      endpointUrl: concreteHosts[0] ? `http://${concreteHosts[0].host}:${input.port}` : null,
      advertisedHost: concreteHosts[0]?.host ?? null,
      availableHosts,
      selectedHost,
    };
  }

  return {
    mode: input.mode,
    bindHost: selectedHost,
    localHttpUrl: `http://${selectedHost}:${input.port}`,
    localWsUrl: `ws://${selectedHost}:${input.port}`,
    endpointUrl: `http://${selectedHost}:${input.port}`,
    advertisedHost: selectedHost,
    availableHosts,
    selectedHost,
  };
}
