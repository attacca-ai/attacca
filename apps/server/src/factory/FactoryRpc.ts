/**
 * Effect wrappers for .factory/ reader/writer.
 *
 * The underlying reader/writer are plain sync Node fs functions. This module
 * lifts them into Effects tagged with FactoryReadError / FactoryWriteError so
 * they can be wired into the WebSocket RPC group.
 */

import { Effect, Schema } from "effect";
import {
  type DispatchWorkPackageResult,
  type FactoryConfig,
  type FactoryDirectory,
  FactoryPathError,
  FactoryProtocolVersionError,
  FactoryReadError,
  type FactoryReadSummaryResult,
  type FactoryRegenerateClaudeMdResult,
  FactoryWriteError,
  type ForgeSkillListResult,
  type Gap,
  type GitIdentityResult,
  type PodiumRootResult,
  type ScanProjectsResult,
  type SessionLog,
  type WorkItem,
  type WorkQueue,
} from "@t3tools/contracts";

import {
  initializeFactory,
  readFactoryDirectory,
  readFactorySummary,
  regenerateClaudeMd,
  writeQueue,
  writeSessionLog,
} from "./index";
import { assertPathInsideAllowedRoot, resolvePodiumRoot } from "./allowedRoots";
import { loadForgeSkills } from "./forgeSkills";
import { resolveGitIdentity } from "./identity";
import { scanProjectsDetailed } from "../scanner";

const isProtocolVersionError = Schema.is(FactoryProtocolVersionError);

const toReadOrProtocolError = (cause: unknown, message: string) => {
  if (isProtocolVersionError(cause)) return cause;
  return new FactoryReadError({ message, cause });
};

const toWriteError = (cause: unknown, message: string) =>
  new FactoryWriteError({
    message,
    cause,
  });

const toWriteOrPathError = (cause: unknown, message: string) => {
  if (isFactoryPathError(cause)) return cause;
  return toWriteError(cause, message);
};

export const readFactoryDirectoryEffect = (
  projectPath: string,
): Effect.Effect<FactoryDirectory, FactoryReadError | FactoryProtocolVersionError> =>
  Effect.try({
    try: () => readFactoryDirectory(projectPath),
    catch: (cause) => toReadOrProtocolError(cause, `Failed to read .factory/ at ${projectPath}`),
  });

export const readFactorySummaryEffect = (
  projectPath: string,
): Effect.Effect<FactoryReadSummaryResult, FactoryReadError | FactoryProtocolVersionError> =>
  Effect.try({
    try: () => readFactorySummary(projectPath),
    catch: (cause) =>
      toReadOrProtocolError(cause, `Failed to read .factory/ summary at ${projectPath}`),
  });

export const initializeFactoryEffect = (
  projectPath: string,
  config: FactoryConfig,
  allowedRoots?: ReadonlyArray<string>,
  autoDetectType = false,
): Effect.Effect<void, FactoryWriteError | FactoryPathError> =>
  Effect.try({
    try: () => {
      assertPathInsideAllowedRoot(projectPath, allowedRoots);
      initializeFactory(projectPath, config, { autoDetectType });
    },
    catch: (cause) => toWriteOrPathError(cause, `Failed to initialize .factory/ at ${projectPath}`),
  });

export const writeQueueEffect = (
  projectPath: string,
  queue: WorkQueue,
  allowedRoots?: ReadonlyArray<string>,
): Effect.Effect<void, FactoryWriteError | FactoryPathError> =>
  Effect.try({
    try: () => {
      assertPathInsideAllowedRoot(projectPath, allowedRoots);
      writeQueue(projectPath, queue);
    },
    catch: (cause) =>
      toWriteOrPathError(cause, `Failed to write .factory/queue.json at ${projectPath}`),
  });

export const writeSessionLogEffect = (
  projectPath: string,
  session: SessionLog,
  allowedRoots?: ReadonlyArray<string>,
): Effect.Effect<void, FactoryWriteError | FactoryPathError> =>
  Effect.try({
    try: () => {
      assertPathInsideAllowedRoot(projectPath, allowedRoots);
      writeSessionLog(projectPath, session);
    },
    catch: (cause) =>
      toWriteOrPathError(cause, `Failed to write .factory/progress session log at ${projectPath}`),
  });

// ---------------------------------------------------------------------------
// Gap dispatch helpers
// ---------------------------------------------------------------------------

const GAP_TO_WORK_ITEM_TITLE: Record<string, string> = {
  missing_config: "Initialize .factory/config.yaml",
  missing_status: "Create .factory/status.json",
  missing_spec: "Write project specification",
  missing_context: "Write project context document",
  empty_queue: "Populate work queue",
  no_session_logs: "Start first work session",
  stale_activity: "Resume stalled project",
  missing_intent_contract: "Write intent contract",
  missing_scenarios: "Write behavioral scenarios",
  incomplete_config: "Complete project configuration",
};

const GAP_TO_WORK_ITEM_TYPE: Record<string, WorkItem["type"]> = {
  missing_config: "spec_gap",
  missing_status: "spec_gap",
  missing_spec: "spec_gap",
  missing_context: "spec_gap",
  empty_queue: "enhancement",
  no_session_logs: "enhancement",
  stale_activity: "enhancement",
  missing_intent_contract: "spec_gap",
  missing_scenarios: "spec_gap",
  incomplete_config: "enhancement",
};

function gapToWorkItem(gap: Gap): WorkItem {
  return {
    id: crypto.randomUUID(),
    priority: gap.severity,
    title: GAP_TO_WORK_ITEM_TITLE[gap.category] ?? `Address ${gap.category}`,
    description: gap.message,
    type: GAP_TO_WORK_ITEM_TYPE[gap.category] ?? "enhancement",
    status: "pending",
  };
}

export const dispatchWorkPackageEffect = (
  projectPath: string,
  gap: Gap,
  allowedRoots?: ReadonlyArray<string>,
): Effect.Effect<
  DispatchWorkPackageResult,
  FactoryWriteError | FactoryPathError | FactoryProtocolVersionError
> =>
  Effect.try({
    try: (): DispatchWorkPackageResult => {
      assertPathInsideAllowedRoot(projectPath, allowedRoots);

      // Read existing queue (or create a fresh one)
      const directory = readFactoryDirectory(projectPath);
      const existingQueue: WorkQueue = directory.queue ?? {
        version: 1,
        generated: new Date().toISOString(),
        generated_by: "podium-dispatch",
        items: [],
      };

      // Idempotency: if a pending item for this gap category already exists,
      // return it instead of creating a duplicate.
      const expectedTitle = GAP_TO_WORK_ITEM_TITLE[gap.category];
      const existing = existingQueue.items.find(
        (item) => item.status === "pending" && item.title === expectedTitle,
      );
      if (existing) {
        return { workItem: existing };
      }

      const workItem = gapToWorkItem(gap);
      const updatedQueue: WorkQueue = {
        ...existingQueue,
        generated: new Date().toISOString(),
        generated_by: "podium-dispatch",
        items: [...existingQueue.items, workItem],
      };

      writeQueue(projectPath, updatedQueue);
      return { workItem };
    },
    catch: (cause) => {
      if (isProtocolVersionError(cause)) return cause;
      if (isFactoryPathError(cause)) return cause;
      return toWriteError(cause, `Failed to dispatch work package at ${projectPath}`);
    },
  });

export const listForgeSkillsEffect = (): Effect.Effect<ForgeSkillListResult, FactoryReadError> =>
  Effect.try({
    try: () => loadForgeSkills(),
    catch: (cause) => new FactoryReadError({ message: "Failed to load Forge skills", cause }),
  });

export const getGitIdentityEffect = (): Effect.Effect<GitIdentityResult, never> =>
  Effect.sync(() => resolveGitIdentity());

const isFactoryPathError = Schema.is(FactoryPathError);

export const getPodiumRootEffect = (): Effect.Effect<PodiumRootResult, never> =>
  Effect.sync(() => resolvePodiumRoot());

export const scanProjectsEffect = (
  rootDir: string | undefined,
): Effect.Effect<ScanProjectsResult, FactoryReadError> =>
  Effect.try({
    try: (): ScanProjectsResult => {
      const effectiveRoot = rootDir?.trim() || resolvePodiumRoot().rootDir;
      const result = scanProjectsDetailed(effectiveRoot);
      return {
        rootDir: effectiveRoot,
        projects: [...result.projects],
        warning: result.warning,
      };
    },
    catch: (cause) =>
      new FactoryReadError({
        message: `Failed to scan projects at ${rootDir ?? "<default>"}`,
        cause,
      }),
  });

export const regenerateClaudeMdEffect = (
  projectPath: string,
  allowedRoots?: ReadonlyArray<string>,
): Effect.Effect<
  FactoryRegenerateClaudeMdResult,
  FactoryWriteError | FactoryProtocolVersionError | FactoryPathError
> =>
  Effect.try({
    try: (): FactoryRegenerateClaudeMdResult => {
      assertPathInsideAllowedRoot(projectPath, allowedRoots);
      const content = regenerateClaudeMd(projectPath);
      return { content, generatedAt: new Date().toISOString() };
    },
    catch: (cause) => {
      if (isProtocolVersionError(cause)) return cause;
      if (isFactoryPathError(cause)) return cause;
      return toWriteError(cause, `Failed to regenerate .factory/CLAUDE.md at ${projectPath}`);
    },
  });
