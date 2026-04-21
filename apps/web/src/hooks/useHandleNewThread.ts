import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import { DEFAULT_RUNTIME_MODE, type ScopedProjectRef } from "@t3tools/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import { deriveLogicalProjectKey } from "../logicalProject";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";

interface NewThreadOptions {
  branch?: string | null;
  worktreePath?: string | null;
  envMode?: DraftThreadEnvMode;
  presetPrompt?: string | null;
}

function isBlankPrompt(prompt: string | null | undefined): boolean {
  return !prompt || prompt.trim().length === 0;
}

function useNewThreadState() {
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const router = useRouter();
  const getCurrentRouteTarget = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteTarget(currentRouteParams);
  }, [router]);

  return useCallback(
    (projectRef: ScopedProjectRef, options?: NewThreadOptions): Promise<void> => {
      const {
        getDraftSessionByLogicalProjectKey,
        getDraftSession,
        getDraftThread,
        getComposerDraft,
        applyStickyState,
        setDraftThreadContext,
        setLogicalProjectDraftThreadId,
        setPrompt,
      } = useComposerDraftStore.getState();
      const currentRouteTarget = getCurrentRouteTarget();
      const project = projects.find(
        (candidate) =>
          candidate.id === projectRef.projectId &&
          candidate.environmentId === projectRef.environmentId,
      );
      const logicalProjectKey = project
        ? deriveLogicalProjectKey(project)
        : scopedProjectKey(projectRef);
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftThread = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      const latestActiveDraftThread: DraftThreadState | null = currentRouteTarget
        ? currentRouteTarget.kind === "server"
          ? getDraftThread(currentRouteTarget.threadRef)
          : getDraftSession(currentRouteTarget.draftId)
        : null;
      if (storedDraftThread) {
        return (async () => {
          if (
            options?.presetPrompt &&
            isBlankPrompt(getComposerDraft(storedDraftThread.draftId)?.prompt)
          ) {
            setPrompt(storedDraftThread.draftId, options.presetPrompt);
          }
          if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
            setDraftThreadContext(storedDraftThread.draftId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, storedDraftThread.draftId, {
            threadId: storedDraftThread.threadId,
          });
          if (
            currentRouteTarget?.kind === "draft" &&
            currentRouteTarget.draftId === storedDraftThread.draftId
          ) {
            return;
          }
          await router.navigate({
            to: "/draft/$draftId",
            params: { draftId: storedDraftThread.draftId },
          });
        })();
      }

      if (
        latestActiveDraftThread &&
        currentRouteTarget?.kind === "draft" &&
        latestActiveDraftThread.logicalProjectKey === logicalProjectKey &&
        latestActiveDraftThread.promotedTo == null
      ) {
        if (
          options?.presetPrompt &&
          isBlankPrompt(getComposerDraft(currentRouteTarget.draftId)?.prompt)
        ) {
          setPrompt(currentRouteTarget.draftId, options.presetPrompt);
        }
        if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
          setDraftThreadContext(currentRouteTarget.draftId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, currentRouteTarget.draftId, {
          threadId: latestActiveDraftThread.threadId,
          createdAt: latestActiveDraftThread.createdAt,
          runtimeMode: latestActiveDraftThread.runtimeMode,
          interactionMode: latestActiveDraftThread.interactionMode,
          ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
          ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
          ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
        });
        return Promise.resolve();
      }

      const draftId = newDraftId();
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
          threadId,
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });
        applyStickyState(draftId);
        if (options?.presetPrompt) {
          setPrompt(draftId, options.presetPrompt);
        }

        await router.navigate({
          to: "/draft/$draftId",
          params: { draftId },
        });
      })();
    },
    [getCurrentRouteTarget, router, projects],
  );
}

export function useNewThreadHandler() {
  const handleNewThread = useNewThreadState();

  return {
    handleNewThread,
  };
}

export function useHandleNewThread() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const activeDraftThread = useComposerDraftStore(() =>
    routeTarget
      ? routeTarget.kind === "server"
        ? getDraftThread(routeTarget.threadRef)
        : useComposerDraftStore.getState().getDraftSession(routeTarget.draftId)
      : null,
  );
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: (project) => scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
    });
  }, [projectOrder, projects]);
  const handleNewThread = useNewThreadState();

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
