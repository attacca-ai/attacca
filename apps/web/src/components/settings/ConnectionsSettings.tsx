import { InfoIcon, QrCodeIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AuthClientSession,
  type AuthPairingLink,
  type DesktopServerExposureState,
} from "@t3tools/contracts";
import { DateTime } from "effect";

import {
  createServerPairingCredential,
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
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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

/** Top rule + `mt-3` from the row header: pairing uses this with a bare `<ul>`; clients adds a summary line first. */
const CONNECTIONS_ACCESS_LIST_OUTER_CLASSNAME = "mt-3 border-t border-border";

const CONNECTIONS_ACCESS_LIST_UL_CLASSNAME =
  "list-none divide-y divide-border pb-4 [&>li]:py-2 [&>li:last-child]:pb-0";

const CONNECTIONS_ROW_PRIMARY_LINE_CLASSNAME =
  "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-none";

/** Same primary → secondary gap for pairing and client rows (`<p>` has no extra `mt-*`). */
const CONNECTIONS_ROW_TEXT_STACK_CLASSNAME = "flex min-w-0 flex-1 flex-col gap-1 text-left";

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

type PairingLinkListRowProps = {
  pairingLink: ServerPairingLinkRecord;
  /** Wall clock for expiry countdown; must update ~1Hz (parent drives via `useRelativeTimeTick`) so React Compiler keeps the row reactive. */
  nowMs: number;
  endpointUrl: string | null | undefined;
  revokingPairingLinkId: string | null;
  onRevoke: (id: string) => void;
};

function PairingLinkListRow({
  pairingLink,
  nowMs,
  endpointUrl,
  revokingPairingLinkId,
  onRevoke,
}: PairingLinkListRowProps) {
  const pairingUrl =
    endpointUrl != null && endpointUrl !== ""
      ? resolveDesktopPairingUrl(endpointUrl, pairingLink.credential)
      : `/pair?token=${pairingLink.credential}`;

  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onCopy: () => {
      toastManager.add({
        type: "success",
        title: "Pairing URL copied",
        description: "Open it in the client you want to pair to this environment.",
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
    copyToClipboard(pairingUrl, undefined);
  }, [copyToClipboard, pairingUrl]);

  const expiresAbsolute = formatAccessTimestamp(pairingLink.expiresAt);

  return (
    <li className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className={CONNECTIONS_ROW_TEXT_STACK_CLASSNAME}>
        <div className={CONNECTIONS_ROW_PRIMARY_LINE_CLASSNAME}>
          <span
            className="size-2 shrink-0 rounded-full invisible pointer-events-none"
            aria-hidden
          />
          <span className="font-medium text-foreground">
            {pairingLink.role === "owner" ? "Owner" : "Client"}
          </span>
          <span className="text-muted-foreground/45" aria-hidden>
            ·
          </span>
          <span className="tabular-nums text-muted-foreground" title={expiresAbsolute}>
            {formatExpiresInLabel(pairingLink.expiresAt, nowMs)}
          </span>
        </div>
        <p
          className="truncate ps-4 font-mono text-[11px] leading-tight text-foreground/90"
          title={pairingUrl}
        >
          {pairingUrl}
        </p>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5 sm:ps-2">
        <Popover>
          <PopoverTrigger
            openOnHover
            delay={250}
            closeDelay={100}
            render={
              <Button
                size="icon-xs"
                variant="outline"
                aria-label="Pairing QR code — hover to preview, click for a larger code to scan"
              />
            }
          >
            <QrCodeIcon aria-hidden className="size-3.5" />
          </PopoverTrigger>
          <PopoverPopup side="top" align="end" tooltipStyle className="w-max">
            <QRCodeSVG
              value={pairingUrl}
              size={88}
              level="M"
              marginSize={2}
              title="Pairing link — scan to open on another device"
            />
          </PopoverPopup>
        </Popover>
        <Button size="xs" variant="outline" onClick={handleCopy}>
          {isCopied ? "Copied" : "Copy"}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={revokingPairingLinkId === pairingLink.id}
          onClick={() => void onRevoke(pairingLink.id)}
        >
          {revokingPairingLinkId === pairingLink.id ? "Revoking…" : "Revoke"}
        </Button>
      </div>
    </li>
  );
}

type ConnectedClientListRowProps = {
  clientSession: ServerClientSessionRecord;
  revokingClientSessionId: string | null;
  onRevokeSession: (sessionId: ServerClientSessionRecord["sessionId"]) => void;
};

function ConnectedClientListRow({
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

  return (
    <li className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className={CONNECTIONS_ROW_TEXT_STACK_CLASSNAME}>
        <div className={CONNECTIONS_ROW_PRIMARY_LINE_CLASSNAME}>
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              isLive ? "bg-success" : "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="truncate font-medium text-foreground">{clientSession.subject}</span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
          </span>
          <span className="text-muted-foreground/45" aria-hidden>
            ·
          </span>
          <span className="text-muted-foreground">{stateLabel}</span>
        </div>
        <p className="ps-4 text-[11px] leading-tight text-muted-foreground">{roleLabel}</p>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5 sm:ps-2">
        <Button
          size="xs"
          variant="outline"
          disabled={clientSession.current || revokingClientSessionId === clientSession.sessionId}
          onClick={() => void onRevokeSession(clientSession.sessionId)}
        >
          {revokingClientSessionId === clientSession.sessionId
            ? "Revoking…"
            : clientSession.current
              ? "This device"
              : "Revoke"}
        </Button>
      </div>
    </li>
  );
}

export function ConnectionsSettings() {
  const desktopBridge = window.desktopBridge;

  const [desktopServerExposureState, setDesktopServerExposureState] =
    useState<DesktopServerExposureState | null>(null);
  const [desktopServerExposureError, setDesktopServerExposureError] = useState<string | null>(null);
  const [isUpdatingDesktopServerExposure, setIsUpdatingDesktopServerExposure] = useState(false);
  const [pendingDesktopServerExposureMode, setPendingDesktopServerExposureMode] = useState<
    DesktopServerExposureState["mode"] | null
  >(null);
  const [isCreatingDesktopPairingUrl, setIsCreatingDesktopPairingUrl] = useState(false);
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

  const createDesktopPairingUrl = useCallback(async () => {
    setIsCreatingDesktopPairingUrl(true);
    setDesktopAccessManagementError(null);
    try {
      await createServerPairingCredential();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create pairing URL.";
      setDesktopAccessManagementError(message);
      toastManager.add({
        type: "error",
        title: "Could not create pairing URL",
        description: message,
      });
    } finally {
      setIsCreatingDesktopPairingUrl(false);
    }
  }, []);

  const handleDesktopServerExposureChange = useCallback(
    async (checked: boolean) => {
      if (!desktopBridge) return;

      setIsUpdatingDesktopServerExposure(true);
      setDesktopServerExposureError(null);
      try {
        const nextState = await desktopBridge.setServerExposureMode(
          checked ? "network-accessible" : "local-only",
        );
        setDesktopServerExposureState(nextState);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update network exposure.";
        setPendingDesktopServerExposureMode(null);
        setDesktopServerExposureError(message);
        toastManager.add({
          type: "error",
          title: "Could not update network access",
          description: message,
        });
        setIsUpdatingDesktopServerExposure(false);
      }
    },
    [desktopBridge],
  );

  const handleConfirmDesktopServerExposureChange = useCallback(() => {
    if (pendingDesktopServerExposureMode === null) return;
    const checked = pendingDesktopServerExposureMode === "network-accessible";
    void handleDesktopServerExposureChange(checked);
  }, [handleDesktopServerExposureChange, pendingDesktopServerExposureMode]);

  const handleCreateDesktopPairingUrl = useCallback(() => {
    if (!desktopServerExposureState?.endpointUrl) return;
    void createDesktopPairingUrl();
  }, [createDesktopPairingUrl, desktopServerExposureState?.endpointUrl]);

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

  useEffect(() => {
    if (!desktopBridge) return;

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

    return () => {
      cancelled = true;
      unsubscribeAuthAccess();
    };
  }, [desktopBridge]);

  const pairingListTimeTick = useRelativeTimeTick(1_000);
  const pairingListNowMs = Date.now();
  const visibleDesktopPairingLinks = useMemo(
    () => {
      const now = Date.now();
      return desktopPairingLinks.filter(
        (pairingLink) => new Date(pairingLink.expiresAt).getTime() > now,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pairingListTimeTick forces 1Hz refresh; body uses Date.now().
    [pairingListTimeTick, desktopPairingLinks],
  );

  if (!desktopBridge) {
    return (
      <SettingsPageContainer>
        <SettingsSection title="Connections">
          <SettingsRow
            title="Remote access"
            description="Pairing links, network exposure, and session management for other clients are available in the T3 Code desktop app."
          />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  const otherClientCount = desktopClientSessions.filter((s) => !s.current).length;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Access">
        <SettingsRow
          title="Network access"
          description="Allow other clients to reach this environment instead of limiting it to this machine."
          status={
            <>
              <span className="block">
                {desktopServerExposureState?.mode === "network-accessible" &&
                desktopServerExposureState.endpointUrl
                  ? "This environment is reachable over the network."
                  : desktopServerExposureState
                    ? "This environment is currently limited to this machine."
                    : "Loading network access state..."}
              </span>
              {desktopServerExposureState?.endpointUrl ? (
                <span className="mt-1 block break-all font-mono text-[11px] text-foreground">
                  {desktopServerExposureState.endpointUrl}
                </span>
              ) : null}
              {desktopServerExposureError ? (
                <span className="mt-1 block text-destructive">{desktopServerExposureError}</span>
              ) : null}
            </>
          }
          control={
            <AlertDialog
              open={pendingDesktopServerExposureMode !== null}
              onOpenChange={(open) => {
                if (isUpdatingDesktopServerExposure) {
                  return;
                }
                if (!open) {
                  setPendingDesktopServerExposureMode(null);
                }
              }}
            >
              <Switch
                checked={desktopServerExposureState?.mode === "network-accessible"}
                disabled={!desktopServerExposureState || isUpdatingDesktopServerExposure}
                onCheckedChange={(checked) => {
                  setPendingDesktopServerExposureMode(
                    checked ? "network-accessible" : "local-only",
                  );
                }}
                aria-label="Enable network access"
              />
              <AlertDialogPopup>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {pendingDesktopServerExposureMode === "network-accessible"
                      ? "Enable network access?"
                      : "Disable network access?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {pendingDesktopServerExposureMode === "network-accessible"
                      ? "T3 Code will restart to expose this environment over the network."
                      : "T3 Code will restart and limit this environment back to this machine."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose
                    disabled={isUpdatingDesktopServerExposure}
                    render={<Button variant="outline" disabled={isUpdatingDesktopServerExposure} />}
                  >
                    Cancel
                  </AlertDialogClose>
                  <Button
                    onClick={handleConfirmDesktopServerExposureChange}
                    disabled={
                      pendingDesktopServerExposureMode === null || isUpdatingDesktopServerExposure
                    }
                  >
                    {isUpdatingDesktopServerExposure ? (
                      <>
                        <Spinner className="size-3.5" />
                        Restarting…
                      </>
                    ) : pendingDesktopServerExposureMode === "network-accessible" ? (
                      "Restart and enable"
                    ) : (
                      "Restart and disable"
                    )}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogPopup>
            </AlertDialog>
          }
        />
        <SettingsRow
          title="Pairing codes"
          description="Generate a one-time pairing code to connect other devices to this environment."
          status={
            desktopAccessManagementError ? (
              <span className="block text-destructive">{desktopAccessManagementError}</span>
            ) : desktopServerExposureState?.mode === "local-only" ? (
              <span className="block text-muted-foreground">
                Enable network access above to create pairing links.
              </span>
            ) : desktopServerExposureState?.mode === "network-accessible" &&
              isLoadingDesktopAccessManagement ? (
              <span className="block text-muted-foreground">Syncing links…</span>
            ) : desktopServerExposureState?.mode === "network-accessible" &&
              !isLoadingDesktopAccessManagement &&
              visibleDesktopPairingLinks.length === 0 ? (
              <span className="block text-muted-foreground">No active pairing links.</span>
            ) : null
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={
                desktopServerExposureState?.mode !== "network-accessible" ||
                !desktopServerExposureState.endpointUrl ||
                isCreatingDesktopPairingUrl
              }
              onClick={handleCreateDesktopPairingUrl}
            >
              {isCreatingDesktopPairingUrl ? "Creating…" : "Create link"}
            </Button>
          }
        >
          {visibleDesktopPairingLinks.length > 0 ? (
            <div className={CONNECTIONS_ACCESS_LIST_OUTER_CLASSNAME}>
              <ul className={CONNECTIONS_ACCESS_LIST_UL_CLASSNAME}>
                {visibleDesktopPairingLinks.map((pairingLink) => (
                  <PairingLinkListRow
                    key={pairingLink.id}
                    pairingLink={pairingLink}
                    nowMs={pairingListNowMs}
                    endpointUrl={desktopServerExposureState?.endpointUrl}
                    revokingPairingLinkId={revokingDesktopPairingLinkId}
                    onRevoke={handleRevokeDesktopPairingLink}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </SettingsRow>
        <SettingsRow
          title="Connected clients"
          description="Sessions authorized for this environment."
          status={
            desktopClientSessions.length === 0 ? (
              <span className="block text-muted-foreground">No sessions yet.</span>
            ) : (
              <span className="block text-muted-foreground">
                {otherClientCount > 0
                  ? `${otherClientCount} other ${otherClientCount === 1 ? "client" : "clients"} can reconnect.`
                  : "Only this client is connected."}
              </span>
            )
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={
                isRevokingOtherDesktopClients ||
                desktopClientSessions.every((clientSession) => clientSession.current)
              }
              onClick={() => void handleRevokeOtherDesktopClients()}
            >
              {isRevokingOtherDesktopClients ? "Revoking…" : "Revoke others"}
            </Button>
          }
        >
          {desktopClientSessions.length > 0 ? (
            <div className={CONNECTIONS_ACCESS_LIST_OUTER_CLASSNAME}>
              <ul className={CONNECTIONS_ACCESS_LIST_UL_CLASSNAME}>
                {desktopClientSessions.map((clientSession) => (
                  <ConnectedClientListRow
                    key={clientSession.sessionId}
                    clientSession={clientSession}
                    revokingClientSessionId={revokingDesktopClientSessionId}
                    onRevokeSession={handleRevokeDesktopClientSession}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
