import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  DEFAULT_MODEL_BY_PROVIDER,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { AlertTriangleIcon, BotIcon, LoaderIcon } from "lucide-react";

import ChatView from "../components/ChatView";
import { Button } from "../components/ui/button";
import { SidebarInset, SidebarTrigger } from "~/components/ui/sidebar";
import { readEnvironmentApi } from "../environmentApi";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { newCommandId, newProjectId, newThreadId } from "../lib/utils";
import { isElectron } from "../env";
import {
  selectEnvironmentState,
  selectProjectsAcrossEnvironments,
  selectThreadExistsByRef,
  useStore,
} from "../store";
import { useArcoStore, ARCO_THREAD_TITLE } from "../stores/arco";

function ArcoRouteView() {
  const activeEnvironmentId = useStore((s) => s.activeEnvironmentId);
  const bootstrapComplete = useStore(
    (s) => selectEnvironmentState(s, activeEnvironmentId).bootstrapComplete,
  );
  const orchestrationProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const arcoSessionId = useSettings((s) => s.arcoSessionId);
  const podiumScanRootOverride = useSettings((s) => s.podiumScanRootOverride);
  const { updateSettings } = useUpdateSettings();
  const arcoStatus = useArcoStore((s) => s.status);
  const arcoError = useArcoStore((s) => s.error);
  const ensureArcoThread = useArcoStore((s) => s.ensureArcoThread);
  const resetArco = useArcoStore((s) => s.reset);

  const threadRef: ScopedThreadRef | null = useMemo(
    () =>
      arcoSessionId && activeEnvironmentId
        ? { environmentId: activeEnvironmentId, threadId: ThreadId.make(arcoSessionId) }
        : null,
    [arcoSessionId, activeEnvironmentId],
  );
  const threadExists = useStore((s) => selectThreadExistsByRef(s, threadRef));

  useEffect(() => {
    if (!bootstrapComplete || !activeEnvironmentId) return;
    if (arcoSessionId && threadExists) return;
    if (arcoStatus !== "idle") return;
    const api = readEnvironmentApi(activeEnvironmentId);
    if (!api) return;

    void ensureArcoThread({
      arcoSessionId,
      threadExists,
      activeEnvironmentId,
      orchestrationProjects,
      podiumScanRootOverride,
      dispatchProjectCreate: async (input) => {
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId: input.projectId,
          title: input.title,
          workspaceRoot: input.workspaceRoot,
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          createdAt: new Date().toISOString(),
        });
      },
      dispatchThreadCreate: async (input) => {
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId: input.threadId,
          projectId: input.projectId,
          title: ARCO_THREAD_TITLE,
          modelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          runtimeMode: "read-only",
          interactionMode: "default",
          scope: "arco",
          branch: null,
          worktreePath: null,
          createdAt: new Date().toISOString(),
        });
      },
      updateSettings,
      newProjectId,
      newThreadId,
    });
  }, [
    bootstrapComplete,
    activeEnvironmentId,
    arcoSessionId,
    threadExists,
    arcoStatus,
    orchestrationProjects,
    podiumScanRootOverride,
    ensureArcoThread,
    updateSettings,
  ]);

  if (threadRef && threadExists) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 md:hidden">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0" />
              <span className="text-sm font-medium text-foreground">Arco</span>
            </div>
          </header>
        )}
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-5">
          <BotIcon className="size-4 text-muted-foreground/60" />
          <span className="text-sm font-medium text-foreground">Arco</span>
          <span className="rounded border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
            Scope: Arco
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {arcoStatus === "error" ? (
            <>
              <AlertTriangleIcon className="size-6 text-red-400/80" />
              <p className="max-w-md text-[13px] text-muted-foreground/70">
                {arcoError ?? "Failed to start Arco."}
              </p>
              <Button size="sm" variant="outline" onClick={resetArco} className="h-7 text-[12px]">
                Retry
              </Button>
            </>
          ) : (
            <>
              <LoaderIcon className="size-5 animate-spin text-muted-foreground/50" />
              <p className="text-[13px] text-muted-foreground/60">Starting Arco...</p>
            </>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/arco")({
  component: ArcoRouteView,
});
