import { InfoIcon, PlusIcon, QrCodeIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  type AuthClientSession,
  type AuthPairingLink,
  type DesktopServerExposureState,
  type EnvironmentId,
} from "@t3tools/contracts";
import { DateTime } from "effect";

import {
  createServerPairingCredential,
  fetchServerAuthSessionState,
  revokeOtherServerClientSessions,
  revokeServerClientSession,
  revokeServerPairingLink,
  type ServerClientSessionRecord,
  type ServerPairingLinkRecord,
} from "../../authBootstrap";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { formatExpiresInLabel } from "../../timestampFormat";
import { getPrimaryWsRpcClientEntry } from "../../wsRpcClient";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "./settingsLayout";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import {
  addSavedEnvironment,
  reconnectSavedEnvironment,
  removeSavedEnvironment,
} from "../../savedEnvironmentConnections";
import { useSavedEnvironmentRegistryStore } from "../../savedEnvironmentRegistryStore";
import { useSavedEnvironmentRuntimeStore } from "../../savedEnvironmentRuntimeStore";

const accessTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatAccessTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return accessTimestampFormatter.format(parsed);
}

/** Direct row in the card – same pattern as the Provider / ACP-agent list rows. */
const ITEM_ROW_CLASSNAME = "border-t border-border/60 px-4 py-4 first:border-t-0 sm:px-5";

const ITEM_ROW_INNER_CLASSNAME =
  "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between";

function sortDesktopPairingLinks(links: ReadonlyArray<ServerPairingLinkRecord>) {
  return [...links].toSorted(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function sortDesktopClientSessions(sessions: ReadonlyArray<ServerClientSessionRecord>) {
  return [...sessions].toSorted((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }
    if (left.connected !== right.connected) {
      return left.connected ? -1 : 1;
    }
    return new Date(right.issuedAt).getTime() - new Date(left.issuedAt).getTime();
  });
}

function toDesktopPairingLinkRecord(pairingLink: AuthPairingLink): ServerPairingLinkRecord {
  return {
    ...pairingLink,
    createdAt: DateTime.formatIso(pairingLink.createdAt),
    expiresAt: DateTime.formatIso(pairingLink.expiresAt),
  };
}

function toDesktopClientSessionRecord(clientSession: AuthClientSession): ServerClientSessionRecord {
  return {
    ...clientSession,
    issuedAt: DateTime.formatIso(clientSession.issuedAt),
    expiresAt: DateTime.formatIso(clientSession.expiresAt),
  };
}

function upsertDesktopPairingLink(
  current: ReadonlyArray<ServerPairingLinkRecord>,
  next: ServerPairingLinkRecord,
) {
  const existingIndex = current.findIndex((pairingLink) => pairingLink.id === next.id);
  if (existingIndex === -1) {
    return sortDesktopPairingLinks([...current, next]);
  }
  const updated = [...current];
  updated[existingIndex] = next;
  return sortDesktopPairingLinks(updated);
}

function removeDesktopPairingLink(current: ReadonlyArray<ServerPairingLinkRecord>, id: string) {
  return current.filter((pairingLink) => pairingLink.id !== id);
}

function upsertDesktopClientSession(
  current: ReadonlyArray<ServerClientSessionRecord>,
  next: ServerClientSessionRecord,
) {
  const existingIndex = current.findIndex(
    (clientSession) => clientSession.sessionId === next.sessionId,
  );
  if (existingIndex === -1) {
    return sortDesktopClientSessions([...current, next]);
  }
  const updated = [...current];
  updated[existingIndex] = next;
  return sortDesktopClientSessions(updated);
}

function removeDesktopClientSession(
  current: ReadonlyArray<ServerClientSessionRecord>,
  sessionId: ServerClientSessionRecord["sessionId"],
) {
  return current.filter((clientSession) => clientSession.sessionId !== sessionId);
}

function resolveDesktopPairingUrl(endpointUrl: string, credential: string): string {
  const url = new URL(endpointUrl);
  url.pathname = "/pair";
  url.searchParams.set("token", credential);
  return url.toString();
}

function resolveCurrentOriginPairingUrl(credential: string): string {
  const url = new URL("/pair", window.location.href);
  url.searchParams.set("token", credential);
  return url.toString();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

type PairingLinkListRowProps = {
  pairingLink: ServerPairingLinkRecord;
  endpointUrl: string | null | undefined;
  revokingPairingLinkId: string | null;
  onRevoke: (id: string) => void;
};

const PairingLinkListRow = memo(function PairingLinkListRow({
  pairingLink,
  endpointUrl,
  revokingPairingLinkId,
  onRevoke,
}: PairingLinkListRowProps) {
  useRelativeTimeTick(1_000);
  const nowMs = Date.now();
  const expiresAtMs = useMemo(
    () => new Date(pairingLink.expiresAt).getTime(),
    [pairingLink.expiresAt],
  );

  const currentOriginPairingUrl = useMemo(
    () => resolveCurrentOriginPairingUrl(pairingLink.credential),
    [pairingLink.credential],
  );
  const shareablePairingUrl =
    endpointUrl != null && endpointUrl !== ""
      ? resolveDesktopPairingUrl(endpointUrl, pairingLink.credential)
      : isLoopbackHostname(window.location.hostname)
        ? null
        : currentOriginPairingUrl;
  const copyValue = shareablePairingUrl ?? pairingLink.credential;

  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onCopy: () => {
      toastManager.add({
        type: "success",
        title: shareablePairingUrl ? "Pairing URL copied" : "Pairing token copied",
        description: shareablePairingUrl
          ? "Open it in the client you want to pair to this environment."
          : "Paste it into another client with this backend's reachable host.",
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not copy pairing URL",
        description: error.message,
      });
    },
  });

  const handleCopy = useCallback(() => {
    copyToClipboard(copyValue, undefined);
  }, [copyToClipboard, copyValue]);

  const expiresAbsolute = formatAccessTimestamp(pairingLink.expiresAt);

  const roleLabel = pairingLink.role === "owner" ? "Owner" : "Client";
  const primaryLabel = pairingLink.label ?? `${roleLabel} link`;

  if (expiresAtMs <= nowMs) {
    return null;
  }

  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full bg-amber-400" aria-hidden />
            <h3 className="text-sm font-medium text-foreground">{primaryLabel}</h3>
            <Popover>
              {shareablePairingUrl ? (
                <>
                  <PopoverTrigger
                    openOnHover
                    delay={250}
                    closeDelay={100}
                    render={
                      <button
                        type="button"
                        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/50 outline-none hover:text-foreground"
                        aria-label="Show QR code"
                      />
                    }
                  >
                    <QrCodeIcon aria-hidden className="size-3" />
                  </PopoverTrigger>
                  <PopoverPopup side="top" align="start" tooltipStyle className="w-max">
                    <QRCodeSVG
                      value={shareablePairingUrl}
                      size={88}
                      level="M"
                      marginSize={2}
                      title="Pairing link — scan to open on another device"
                    />
                  </PopoverPopup>
                </>
              ) : null}
            </Popover>
          </div>
          <p className="text-xs text-muted-foreground" title={expiresAbsolute}>
            {[roleLabel, formatExpiresInLabel(pairingLink.expiresAt, nowMs)].join(" · ")}
          </p>
          {shareablePairingUrl === null ? (
            <p className="text-[11px] text-muted-foreground/70">
              Copy the token and pair from another client using this backend&apos;s reachable host.
            </p>
          ) : null}
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
          <Button
            size="xs"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
          >
            {isCopied ? "Copied" : shareablePairingUrl ? "Copy" : "Copy token"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            disabled={revokingPairingLinkId === pairingLink.id}
            onClick={() => void onRevoke(pairingLink.id)}
          >
            {revokingPairingLinkId === pairingLink.id ? "Revoking…" : "Revoke"}
          </Button>
        </div>
      </div>
    </div>
  );
});

type ConnectedClientListRowProps = {
  clientSession: ServerClientSessionRecord;
  revokingClientSessionId: string | null;
  onRevokeSession: (sessionId: ServerClientSessionRecord["sessionId"]) => void;
};

const ConnectedClientListRow = memo(function ConnectedClientListRow({
  clientSession,
  revokingClientSessionId,
  onRevokeSession,
}: ConnectedClientListRowProps) {
  const stateLabel = clientSession.current
    ? "This client"
    : clientSession.connected
      ? "Connected"
      : "Offline";
  const isLive = clientSession.current || clientSession.connected;
  const roleLabel = clientSession.role === "owner" ? "Owner" : "Client";
  const deviceInfoBits = [
    clientSession.client.deviceType !== "unknown"
      ? clientSession.client.deviceType[0]?.toUpperCase() + clientSession.client.deviceType.slice(1)
      : null,
    clientSession.client.os ?? null,
    clientSession.client.browser ?? null,
    clientSession.client.ipAddress ?? null,
  ].filter((value): value is string => value !== null);
  const primaryLabel =
    clientSession.client.label ??
    ([clientSession.client.os, clientSession.client.browser].filter(Boolean).join(" · ") ||
      clientSession.subject);

  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <span className="relative flex size-2 shrink-0" aria-hidden>
              {isLive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60 duration-[2000ms]" />
              )}
              <span
                className={cn(
                  "relative inline-flex size-2 rounded-full",
                  isLive ? "bg-success" : "bg-muted-foreground/30",
                )}
              />
            </span>
            <h3 className="text-sm font-medium text-foreground">{primaryLabel}</h3>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/50 outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                    aria-label="Show issued and expiry times"
                  />
                }
              >
                <InfoIcon className="size-3 shrink-0" />
              </TooltipTrigger>
              <TooltipPopup side="top" className="max-w-xs text-left text-xs">
                <p className="text-muted-foreground">
                  Issued {formatAccessTimestamp(clientSession.issuedAt)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Expires {formatAccessTimestamp(clientSession.expiresAt)}
                </p>
              </TooltipPopup>
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground">
            {[stateLabel, roleLabel, ...deviceInfoBits].join(" · ")}
          </p>
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
          {clientSession.current ? (
            <span className="rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              This device
            </span>
          ) : (
            <Button
              size="xs"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              disabled={revokingClientSessionId === clientSession.sessionId}
              onClick={() => void onRevokeSession(clientSession.sessionId)}
            >
              {revokingClientSessionId === clientSession.sessionId ? "Revoking…" : "Revoke"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});

type PairingControlsRowProps = {
  isLoading: boolean;
  error: string | null;
  clientSessions: ReadonlyArray<ServerClientSessionRecord>;
  isRevokingOtherClients: boolean;
  onRevokeOtherClients: () => void;
};

const PairingControlsRow = memo(function PairingControlsRow({
  isLoading,
  error,
  clientSessions,
  isRevokingOtherClients,
  onRevokeOtherClients,
}: PairingControlsRowProps) {
  const [pairingLabel, setPairingLabel] = useState("");
  const [isCreatingPairingLink, setIsCreatingPairingLink] = useState(false);

  const handleCreatePairingLink = useCallback(async () => {
    setIsCreatingPairingLink(true);
    try {
      await createServerPairingCredential(pairingLabel);
      setPairingLabel("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create pairing URL.";
      toastManager.add({
        type: "error",
        title: "Could not create pairing URL",
        description: message,
      });
    } finally {
      setIsCreatingPairingLink(false);
    }
  }, [pairingLabel]);

  return (
    <>
      <SettingsRow
        title="Pairing & clients"
        description={error ?? "Manage pairing links and authorized client sessions."}
        status={
          error ? (
            <span className="block text-destructive">{error}</span>
          ) : isLoading ? (
            <span className="block text-muted-foreground/60">Syncing…</span>
          ) : null
        }
        control={
          <div className="flex items-center gap-2">
            <Input
              value={pairingLabel}
              onChange={(event) => setPairingLabel(event.target.value)}
              placeholder="Client label (optional)"
              disabled={isCreatingPairingLink}
              className="h-7 w-44 text-xs"
            />
            <Button
              size="xs"
              variant="outline"
              disabled={
                isRevokingOtherClients ||
                clientSessions.every((clientSession) => clientSession.current)
              }
              onClick={() => void onRevokeOtherClients()}
            >
              {isRevokingOtherClients ? "Revoking…" : "Revoke others"}
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={isCreatingPairingLink}
              onClick={() => void handleCreatePairingLink()}
            >
              {isCreatingPairingLink ? "Creating…" : "Create link"}
            </Button>
          </div>
        }
      />
    </>
  );
});

type PairingClientsListProps = {
  endpointUrl: string | null | undefined;
  isLoading: boolean;
  pairingLinks: ReadonlyArray<ServerPairingLinkRecord>;
  clientSessions: ReadonlyArray<ServerClientSessionRecord>;
  revokingPairingLinkId: string | null;
  revokingClientSessionId: string | null;
  onRevokePairingLink: (id: string) => void;
  onRevokeClientSession: (sessionId: ServerClientSessionRecord["sessionId"]) => void;
};

const PairingClientsList = memo(function PairingClientsList({
  endpointUrl,
  isLoading,
  pairingLinks,
  clientSessions,
  revokingPairingLinkId,
  revokingClientSessionId,
  onRevokePairingLink,
  onRevokeClientSession,
}: PairingClientsListProps) {
  return (
    <>
      {pairingLinks.map((pairingLink) => (
        <PairingLinkListRow
          key={pairingLink.id}
          pairingLink={pairingLink}
          endpointUrl={endpointUrl}
          revokingPairingLinkId={revokingPairingLinkId}
          onRevoke={onRevokePairingLink}
        />
      ))}

      {clientSessions.map((clientSession) => (
        <ConnectedClientListRow
          key={clientSession.sessionId}
          clientSession={clientSession}
          revokingClientSessionId={revokingClientSessionId}
          onRevokeSession={onRevokeClientSession}
        />
      ))}

      {pairingLinks.length === 0 && clientSessions.length === 0 && !isLoading ? (
        <div className={ITEM_ROW_CLASSNAME}>
          <p className="text-xs text-muted-foreground/60">No pairing links or client sessions.</p>
        </div>
      ) : null}
    </>
  );
});

type PairingAndClientsSectionProps = PairingControlsRowProps & PairingClientsListProps;

function PairingAndClientsSection({
  endpointUrl,
  isLoading,
  error,
  pairingLinks,
  clientSessions,
  revokingPairingLinkId,
  revokingClientSessionId,
  isRevokingOtherClients,
  onRevokePairingLink,
  onRevokeClientSession,
  onRevokeOtherClients,
}: PairingAndClientsSectionProps) {
  return (
    <>
      <PairingControlsRow
        isLoading={isLoading}
        error={error}
        clientSessions={clientSessions}
        isRevokingOtherClients={isRevokingOtherClients}
        onRevokeOtherClients={onRevokeOtherClients}
      />
      <PairingClientsList
        endpointUrl={endpointUrl}
        isLoading={isLoading}
        pairingLinks={pairingLinks}
        clientSessions={clientSessions}
        revokingPairingLinkId={revokingPairingLinkId}
        revokingClientSessionId={revokingClientSessionId}
        onRevokePairingLink={onRevokePairingLink}
        onRevokeClientSession={onRevokeClientSession}
      />
    </>
  );
}

type SavedBackendListRowProps = {
  environmentId: EnvironmentId;
  reconnectingEnvironmentId: EnvironmentId | null;
  removingEnvironmentId: EnvironmentId | null;
  onReconnect: (environmentId: EnvironmentId) => void;
  onRemove: (environmentId: EnvironmentId) => void;
};

function SavedBackendListRow({
  environmentId,
  reconnectingEnvironmentId,
  removingEnvironmentId,
  onReconnect,
  onRemove,
}: SavedBackendListRowProps) {
  const record = useSavedEnvironmentRegistryStore((state) => state.byId[environmentId] ?? null);
  const runtime = useSavedEnvironmentRuntimeStore((state) => state.byId[environmentId] ?? null);

  if (!record) {
    return null;
  }

  const connectionState = runtime?.connectionState ?? "disconnected";
  const stateDotClassName =
    connectionState === "connected"
      ? "bg-success"
      : connectionState === "connecting"
        ? "bg-warning"
        : connectionState === "error"
          ? "bg-destructive"
          : "bg-muted-foreground/40";
  const statusLabel =
    connectionState === "connected"
      ? "Connected"
      : connectionState === "connecting"
        ? "Connecting"
        : connectionState === "error"
          ? "Error"
          : "Disconnected";
  const roleLabel = runtime?.role ? (runtime.role === "owner" ? "Owner" : "Client") : null;
  const descriptorLabel = runtime?.descriptor?.label ?? null;

  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <span className="relative flex size-2 shrink-0" aria-hidden>
              {connectionState === "connecting" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning/60 duration-[2000ms]" />
              )}
              <span className={cn("relative inline-flex size-2 rounded-full", stateDotClassName)} />
            </span>
            <h3 className="text-sm font-medium text-foreground">{record.label}</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            <span
              className={cn(
                connectionState === "connected" && "text-success-foreground/80",
                connectionState === "error" && "text-destructive",
              )}
            >
              {statusLabel}
            </span>
            {roleLabel ? ` · ${roleLabel}` : null}
            {record.lastConnectedAt
              ? ` · Last connected ${formatAccessTimestamp(record.lastConnectedAt)}`
              : null}
          </p>
          {descriptorLabel && descriptorLabel !== record.label ? (
            <p className="text-xs text-muted-foreground">Server label: {descriptorLabel}</p>
          ) : null}
          {runtime?.lastError ? (
            <p className="text-xs text-destructive/80">{runtime.lastError}</p>
          ) : null}
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
          <Button
            size="xs"
            variant="outline"
            disabled={reconnectingEnvironmentId === environmentId}
            onClick={() => void onReconnect(environmentId)}
          >
            {reconnectingEnvironmentId === environmentId ? "Reconnecting…" : "Reconnect"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            disabled={removingEnvironmentId === environmentId}
            onClick={() => void onRemove(environmentId)}
          >
            {removingEnvironmentId === environmentId ? "Removing…" : "Remove"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConnectionsSettings() {
  const desktopBridge = window.desktopBridge;
  const [currentSessionRole, setCurrentSessionRole] = useState<"owner" | "client" | null>(
    desktopBridge ? "owner" : null,
  );
  const [currentAuthPolicy, setCurrentAuthPolicy] = useState<
    "desktop-managed-local" | "loopback-browser" | "remote-reachable" | "unsafe-no-auth" | null
  >(desktopBridge ? null : null);
  const savedEnvironmentsById = useSavedEnvironmentRegistryStore((state) => state.byId);
  const savedEnvironmentIds = useMemo(
    () =>
      Object.values(savedEnvironmentsById)
        .toSorted((left, right) => left.label.localeCompare(right.label))
        .map((record) => record.environmentId),
    [savedEnvironmentsById],
  );

  const [desktopServerExposureState, setDesktopServerExposureState] =
    useState<DesktopServerExposureState | null>(null);
  const [desktopServerExposureError, setDesktopServerExposureError] = useState<string | null>(null);
  const [desktopPairingLinks, setDesktopPairingLinks] = useState<
    ReadonlyArray<ServerPairingLinkRecord>
  >([]);
  const [desktopClientSessions, setDesktopClientSessions] = useState<
    ReadonlyArray<ServerClientSessionRecord>
  >([]);
  const [desktopAccessManagementError, setDesktopAccessManagementError] = useState<string | null>(
    null,
  );
  const [isLoadingDesktopAccessManagement, setIsLoadingDesktopAccessManagement] = useState(false);
  const [revokingDesktopPairingLinkId, setRevokingDesktopPairingLinkId] = useState<string | null>(
    null,
  );
  const [revokingDesktopClientSessionId, setRevokingDesktopClientSessionId] = useState<
    string | null
  >(null);
  const [isRevokingOtherDesktopClients, setIsRevokingOtherDesktopClients] = useState(false);
  const [addBackendDialogOpen, setAddBackendDialogOpen] = useState(false);
  const [savedBackendMode, setSavedBackendMode] = useState<"pairing-url" | "host-code">(
    "pairing-url",
  );
  const [savedBackendLabel, setSavedBackendLabel] = useState("");
  const [savedBackendPairingUrl, setSavedBackendPairingUrl] = useState("");
  const [savedBackendHost, setSavedBackendHost] = useState("");
  const [savedBackendPairingCode, setSavedBackendPairingCode] = useState("");
  const [savedBackendError, setSavedBackendError] = useState<string | null>(null);
  const [isAddingSavedBackend, setIsAddingSavedBackend] = useState(false);
  const [reconnectingSavedEnvironmentId, setReconnectingSavedEnvironmentId] =
    useState<EnvironmentId | null>(null);
  const [removingSavedEnvironmentId, setRemovingSavedEnvironmentId] =
    useState<EnvironmentId | null>(null);
  const canManageLocalBackend = currentSessionRole === "owner";
  const isLocalBackendNetworkAccessible = desktopBridge
    ? desktopServerExposureState?.mode === "network-accessible"
    : currentAuthPolicy === "remote-reachable";

  const handleRevokeDesktopPairingLink = useCallback(async (id: string) => {
    setRevokingDesktopPairingLinkId(id);
    setDesktopAccessManagementError(null);
    try {
      await revokeServerPairingLink(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to revoke pairing link.";
      setDesktopAccessManagementError(message);
      toastManager.add({
        type: "error",
        title: "Could not revoke pairing link",
        description: message,
      });
    } finally {
      setRevokingDesktopPairingLinkId(null);
    }
  }, []);

  const handleRevokeDesktopClientSession = useCallback(
    async (sessionId: ServerClientSessionRecord["sessionId"]) => {
      setRevokingDesktopClientSessionId(sessionId);
      setDesktopAccessManagementError(null);
      try {
        await revokeServerClientSession(sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to revoke client access.";
        setDesktopAccessManagementError(message);
        toastManager.add({
          type: "error",
          title: "Could not revoke client access",
          description: message,
        });
      } finally {
        setRevokingDesktopClientSessionId(null);
      }
    },
    [],
  );

  const handleRevokeOtherDesktopClients = useCallback(async () => {
    setIsRevokingOtherDesktopClients(true);
    setDesktopAccessManagementError(null);
    try {
      const revokedCount = await revokeOtherServerClientSessions();
      toastManager.add({
        type: "success",
        title: revokedCount === 1 ? "Revoked 1 other client" : `Revoked ${revokedCount} clients`,
        description: "Other paired clients will need a new pairing link before reconnecting.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to revoke other clients.";
      setDesktopAccessManagementError(message);
      toastManager.add({
        type: "error",
        title: "Could not revoke other clients",
        description: message,
      });
    } finally {
      setIsRevokingOtherDesktopClients(false);
    }
  }, []);

  const handleAddSavedBackend = useCallback(async () => {
    setIsAddingSavedBackend(true);
    setSavedBackendError(null);
    try {
      const record = await addSavedEnvironment({
        label: savedBackendLabel,
        ...(savedBackendMode === "pairing-url"
          ? { pairingUrl: savedBackendPairingUrl }
          : {
              host: savedBackendHost,
              pairingCode: savedBackendPairingCode,
            }),
      });
      setSavedBackendLabel("");
      setSavedBackendPairingUrl("");
      setSavedBackendHost("");
      setSavedBackendPairingCode("");
      setAddBackendDialogOpen(false);
      toastManager.add({
        type: "success",
        title: "Backend added",
        description: `${record.label} is now saved and will reconnect on app startup.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add backend.";
      setSavedBackendError(message);
      toastManager.add({
        type: "error",
        title: "Could not add backend",
        description: message,
      });
    } finally {
      setIsAddingSavedBackend(false);
    }
  }, [
    savedBackendHost,
    savedBackendLabel,
    savedBackendMode,
    savedBackendPairingCode,
    savedBackendPairingUrl,
  ]);

  const handleReconnectSavedBackend = useCallback(async (environmentId: EnvironmentId) => {
    setReconnectingSavedEnvironmentId(environmentId);
    setSavedBackendError(null);
    try {
      await reconnectSavedEnvironment(environmentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reconnect backend.";
      setSavedBackendError(message);
      toastManager.add({
        type: "error",
        title: "Could not reconnect backend",
        description: message,
      });
    } finally {
      setReconnectingSavedEnvironmentId(null);
    }
  }, []);

  const handleRemoveSavedBackend = useCallback(async (environmentId: EnvironmentId) => {
    setRemovingSavedEnvironmentId(environmentId);
    setSavedBackendError(null);
    try {
      await removeSavedEnvironment(environmentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove backend.";
      setSavedBackendError(message);
      toastManager.add({
        type: "error",
        title: "Could not remove backend",
        description: message,
      });
    } finally {
      setRemovingSavedEnvironmentId(null);
    }
  }, []);

  useEffect(() => {
    if (desktopBridge) {
      setCurrentSessionRole("owner");
      return;
    }

    let cancelled = false;
    void fetchServerAuthSessionState()
      .then((session) => {
        if (cancelled) return;
        setCurrentSessionRole(session.authenticated ? (session.role ?? null) : null);
        setCurrentAuthPolicy(session.auth.policy);
      })
      .catch(() => {
        if (cancelled) return;
        setCurrentSessionRole(null);
        setCurrentAuthPolicy(null);
      });

    return () => {
      cancelled = true;
    };
  }, [desktopBridge]);

  useEffect(() => {
    if (!canManageLocalBackend) return;

    let cancelled = false;
    setIsLoadingDesktopAccessManagement(true);
    const unsubscribeAuthAccess = getPrimaryWsRpcClientEntry().client.server.subscribeAuthAccess(
      (event) => {
        if (cancelled) {
          return;
        }

        switch (event.type) {
          case "snapshot":
            setDesktopPairingLinks(
              sortDesktopPairingLinks(
                event.payload.pairingLinks.map((pairingLink) =>
                  toDesktopPairingLinkRecord(pairingLink),
                ),
              ),
            );
            setDesktopClientSessions(
              sortDesktopClientSessions(
                event.payload.clientSessions.map((clientSession) =>
                  toDesktopClientSessionRecord(clientSession),
                ),
              ),
            );
            break;
          case "pairingLinkUpserted":
            setDesktopPairingLinks((current) =>
              upsertDesktopPairingLink(current, toDesktopPairingLinkRecord(event.payload)),
            );
            break;
          case "pairingLinkRemoved":
            setDesktopPairingLinks((current) =>
              removeDesktopPairingLink(current, event.payload.id),
            );
            break;
          case "clientUpserted":
            setDesktopClientSessions((current) =>
              upsertDesktopClientSession(current, toDesktopClientSessionRecord(event.payload)),
            );
            break;
          case "clientRemoved":
            setDesktopClientSessions((current) =>
              removeDesktopClientSession(current, event.payload.sessionId),
            );
            break;
        }

        setDesktopAccessManagementError(null);
        setIsLoadingDesktopAccessManagement(false);
      },
      {
        onResubscribe: () => {
          if (!cancelled) {
            setIsLoadingDesktopAccessManagement(true);
          }
        },
      },
    );
    if (desktopBridge) {
      void desktopBridge
        .getServerExposureState()
        .then((state) => {
          if (cancelled) return;
          setDesktopServerExposureState(state);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message =
            error instanceof Error ? error.message : "Failed to load network exposure state.";
          setDesktopServerExposureError(message);
        });
    } else {
      setDesktopServerExposureState(null);
      setDesktopServerExposureError(null);
    }

    return () => {
      cancelled = true;
      unsubscribeAuthAccess();
    };
  }, [canManageLocalBackend, desktopBridge]);

  useEffect(() => {
    if (canManageLocalBackend) return;
    setIsLoadingDesktopAccessManagement(false);
    setDesktopPairingLinks([]);
    setDesktopClientSessions([]);
    setDesktopAccessManagementError(null);
    setDesktopServerExposureState(null);
    setDesktopServerExposureError(null);
  }, [canManageLocalBackend]);
  const visibleDesktopPairingLinks = useMemo(
    () => desktopPairingLinks.filter((pairingLink) => pairingLink.role === "client"),
    [desktopPairingLinks],
  );
  return (
    <SettingsPageContainer>
      {canManageLocalBackend ? (
        <SettingsSection title="Local backend access">
          {desktopBridge ? (
            <SettingsRow
              title="Network access"
              description={
                desktopServerExposureState?.endpointUrl
                  ? `Reachable at ${desktopServerExposureState.endpointUrl}`
                  : desktopServerExposureState
                    ? "Limited to this machine."
                    : "Loading…"
              }
              status={
                desktopServerExposureError ? (
                  <span className="block text-destructive">{desktopServerExposureError}</span>
                ) : null
              }
              control={
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="inline-flex">
                        <Switch
                          checked={desktopServerExposureState?.mode === "network-accessible"}
                          disabled
                          aria-label="Enable network access"
                        />
                      </span>
                    }
                  />
                  <TooltipPopup side="top">
                    Network exposure changes restart the backend and can only be controlled from the
                    desktop app shell.
                  </TooltipPopup>
                </Tooltip>
              }
            />
          ) : (
            <SettingsRow
              title="Network access"
              description={
                currentAuthPolicy === "remote-reachable"
                  ? "This backend is already configured for remote access. Network exposure changes must be made where the server is launched."
                  : "This backend is only reachable on this machine. Restart it with a non-loopback host to enable remote pairing."
              }
              control={
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="inline-flex">
                        <Switch
                          checked={isLocalBackendNetworkAccessible}
                          disabled
                          aria-label="Enable network access"
                        />
                      </span>
                    }
                  />
                  <TooltipPopup side="top">
                    Network exposure changes restart the backend and must be controlled where the
                    server process is launched.
                  </TooltipPopup>
                </Tooltip>
              }
            />
          )}
          {isLocalBackendNetworkAccessible ? (
            <PairingAndClientsSection
              endpointUrl={desktopServerExposureState?.endpointUrl}
              isLoading={isLoadingDesktopAccessManagement}
              error={desktopAccessManagementError}
              pairingLinks={visibleDesktopPairingLinks}
              clientSessions={desktopClientSessions}
              revokingPairingLinkId={revokingDesktopPairingLinkId}
              revokingClientSessionId={revokingDesktopClientSessionId}
              isRevokingOtherClients={isRevokingOtherDesktopClients}
              onRevokePairingLink={handleRevokeDesktopPairingLink}
              onRevokeClientSession={handleRevokeDesktopClientSession}
              onRevokeOtherClients={handleRevokeOtherDesktopClients}
            />
          ) : null}
        </SettingsSection>
      ) : (
        <SettingsSection title="Local backend access">
          <SettingsRow
            title="Owner tools"
            description="Pairing links and client-session management are only available to owner sessions for this backend."
          />
        </SettingsSection>
      )}

      <SettingsSection
        title="Saved backends"
        headerAction={
          <Dialog
            open={addBackendDialogOpen}
            onOpenChange={(open) => {
              setAddBackendDialogOpen(open);
              if (!open) {
                setSavedBackendError(null);
              }
            }}
          >
            <DialogTrigger
              render={
                <Button size="xs" variant="outline">
                  <PlusIcon className="size-3" />
                  Add backend
                </Button>
              }
            />
            <DialogPopup>
              <DialogHeader>
                <DialogTitle>Add Backend</DialogTitle>
                <DialogDescription>
                  Pair another environment to this client. The connection is only saved after the
                  remote auth and websocket connection succeed.
                </DialogDescription>
                <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/50 p-1">
                  <button
                    type="button"
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      savedBackendMode === "pairing-url"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={isAddingSavedBackend}
                    onClick={() => setSavedBackendMode("pairing-url")}
                  >
                    Pairing URL
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      savedBackendMode === "host-code"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={isAddingSavedBackend}
                    onClick={() => setSavedBackendMode("host-code")}
                  >
                    Host + code
                  </button>
                </div>
              </DialogHeader>
              <DialogPanel>
                <div className="space-y-4">
                  {savedBackendMode === "pairing-url" ? (
                    <p className="text-xs text-muted-foreground">
                      Enter the full pairing URL from the environment you want to connect to.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Enter the backend host and pairing code separately.
                    </p>
                  )}
                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-foreground">
                        Label
                      </span>
                      <Input
                        value={savedBackendLabel}
                        onChange={(event) => setSavedBackendLabel(event.target.value)}
                        placeholder="My backend (optional)"
                        disabled={isAddingSavedBackend}
                        spellCheck={false}
                      />
                    </label>
                    {savedBackendMode === "pairing-url" ? (
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-foreground">
                          Pairing URL
                        </span>
                        <Input
                          value={savedBackendPairingUrl}
                          onChange={(event) => setSavedBackendPairingUrl(event.target.value)}
                          placeholder="https://backend.example.com/pair?token=..."
                          disabled={isAddingSavedBackend}
                          spellCheck={false}
                        />
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          The full URL including the pairing token.
                        </span>
                      </label>
                    ) : (
                      <>
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-medium text-foreground">
                            Host
                          </span>
                          <Input
                            value={savedBackendHost}
                            onChange={(event) => setSavedBackendHost(event.target.value)}
                            placeholder="https://backend.example.com"
                            disabled={isAddingSavedBackend}
                            spellCheck={false}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-medium text-foreground">
                            Pairing code
                          </span>
                          <Input
                            value={savedBackendPairingCode}
                            onChange={(event) => setSavedBackendPairingCode(event.target.value)}
                            placeholder="Pairing code"
                            disabled={isAddingSavedBackend}
                            spellCheck={false}
                          />
                        </label>
                      </>
                    )}
                  </div>
                  {savedBackendError ? (
                    <p className="text-xs text-destructive">{savedBackendError}</p>
                  ) : null}
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={isAddingSavedBackend}
                    onClick={() => void handleAddSavedBackend()}
                  >
                    <PlusIcon className="size-3.5" />
                    {isAddingSavedBackend ? "Adding…" : "Add Backend"}
                  </Button>
                </div>
              </DialogPanel>
            </DialogPopup>
          </Dialog>
        }
      >
        {savedEnvironmentIds.map((environmentId) => (
          <SavedBackendListRow
            key={environmentId}
            environmentId={environmentId}
            reconnectingEnvironmentId={reconnectingSavedEnvironmentId}
            removingEnvironmentId={removingSavedEnvironmentId}
            onReconnect={handleReconnectSavedBackend}
            onRemove={handleRemoveSavedBackend}
          />
        ))}

        {savedEnvironmentIds.length === 0 ? (
          <div className={ITEM_ROW_CLASSNAME}>
            <p className="text-xs text-muted-foreground">
              No saved backends yet. Click &ldquo;Add backend&rdquo; to pair another environment.
            </p>
          </div>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
