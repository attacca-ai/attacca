import { scopedProjectKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { DEFAULT_RUNTIME_MODE, type ScopedProjectRef } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newThreadId } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";

export function useHandleNewThread() {
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const navigate = useNavigate();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const getDraftThreadByRef = useComposerDraftStore((store) => store.getDraftThreadByRef);
  const activeDraftThread = useComposerDraftStore(() =>
    routeThreadRef ? getDraftThreadByRef(routeThreadRef) : null,
  );
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: (project) => scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
    });
  }, [projectOrder, projects]);

  const handleNewThread = useCallback(
    (
      projectRef: ScopedProjectRef,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const {
        clearProjectDraftThreadId,
        getDraftThreadByRef,
        getDraftThreadByProjectRef,
        applyStickyState,
        setDraftThreadContext,
        setProjectDraftThreadId,
      } = useComposerDraftStore.getState();
      const projectId = projectRef.projectId;
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftThread = getDraftThreadByProjectRef(projectRef);
      const latestActiveDraftThread: DraftThreadState | null = routeThreadRef
        ? getDraftThreadByRef(routeThreadRef)
        : null;
      if (storedDraftThread) {
        return (async () => {
          if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
            setDraftThreadContext(storedDraftThread.threadRef, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setProjectDraftThreadId(projectRef, storedDraftThread.threadRef);
          if (routeThreadRef?.threadId === storedDraftThread.threadId) {
            return;
          }
          await navigate({
            to: "/$environmentId/$threadId",
            params: {
              environmentId: projectRef.environmentId,
              threadId: storedDraftThread.threadId,
            },
          });
        })();
      }

      clearProjectDraftThreadId(projectRef);

      if (
        latestActiveDraftThread &&
        routeThreadRef &&
        latestActiveDraftThread.projectId === projectId
      ) {
        if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
          setDraftThreadContext(routeThreadRef, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setProjectDraftThreadId(projectRef, routeThreadRef);
        return Promise.resolve();
      }

      const threadId = newThreadId();
      const threadRef = scopeThreadRef(projectRef.environmentId, threadId);
      const createdAt = new Date().toISOString();
      return (async () => {
        setProjectDraftThreadId(projectRef, threadRef, {
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });
        applyStickyState(threadRef);

        await navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: projectRef.environmentId,
            threadId,
          },
        });
      })();
    },
    [getDraftThreadByRef, navigate, routeThreadRef],
  );

  return {
    activeDraftThread,
    activeThread,
    defaultProjectRef: orderedProjects[0]
      ? scopeProjectRef(orderedProjects[0].environmentId, orderedProjects[0].id)
      : null,
    handleNewThread,
    routeThreadRef,
  };
}
