import { scopeThreadRef } from "@t3tools/client-runtime";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

export type ThreadRouteTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      kind: "draft";
      threadId: ThreadId;
    };

export function buildThreadRouteParams(ref: ScopedThreadRef): {
  environmentId: EnvironmentId;
  threadId: ThreadId;
} {
  return {
    environmentId: ref.environmentId,
    threadId: ref.threadId,
  };
}

export function buildDraftThreadRouteParams(threadId: ThreadId): {
  threadId: ThreadId;
} {
  return { threadId };
}

export function resolveThreadRouteRef(
  params: Partial<Record<"environmentId" | "threadId", string | undefined>>,
): ScopedThreadRef | null {
  if (!params.environmentId || !params.threadId) {
    return null;
  }

  return scopeThreadRef(params.environmentId as EnvironmentId, params.threadId as ThreadId);
}

export function resolveThreadRouteTarget(
  params: Partial<Record<"environmentId" | "threadId", string | undefined>>,
): ThreadRouteTarget | null {
  if (!params.threadId) {
    return null;
  }

  if (params.environmentId) {
    return {
      kind: "server",
      threadRef: scopeThreadRef(params.environmentId as EnvironmentId, params.threadId as ThreadId),
    };
  }

  return {
    kind: "draft",
    threadId: params.threadId as ThreadId,
  };
}
