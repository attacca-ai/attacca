import type {
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadSessionRef,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

interface EnvironmentScopedRef<TId extends string> {
  readonly environmentId: EnvironmentId;
  readonly id: TId;
}

export interface EnvironmentClientRegistry<TClient> {
  readonly getClient: (environmentId: EnvironmentId) => TClient | null | undefined;
}

export function scopeProjectRef(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ScopedProjectRef {
  return { environmentId, projectId };
}

export function scopeThreadRef(environmentId: EnvironmentId, threadId: ThreadId): ScopedThreadRef {
  return { environmentId, threadId };
}

export function scopeThreadSessionRef(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): ScopedThreadSessionRef {
  return { environmentId, threadId };
}

export function scopedRefKey(
  ref: EnvironmentScopedRef<string> | ScopedProjectRef | ScopedThreadRef | ScopedThreadSessionRef,
): string {
  const localId = "id" in ref ? ref.id : "projectId" in ref ? ref.projectId : ref.threadId;
  return `${ref.environmentId}:${localId}`;
}

export function resolveEnvironmentClient<TClient>(
  registry: EnvironmentClientRegistry<TClient>,
  ref: EnvironmentScopedRef<string>,
): TClient {
  const client = registry.getClient(ref.environmentId);
  if (!client) {
    throw new Error(`No client registered for environment ${ref.environmentId}.`);
  }
  return client;
}

export function tagEnvironmentValue<T>(
  environmentId: EnvironmentId,
  value: T,
): { readonly environmentId: EnvironmentId; readonly value: T } {
  return { environmentId, value };
}
