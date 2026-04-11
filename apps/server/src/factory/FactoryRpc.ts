/**
 * Effect wrappers for .factory/ reader/writer.
 *
 * The underlying reader/writer are plain sync Node fs functions. This module
 * lifts them into Effects tagged with FactoryReadError / FactoryWriteError so
 * they can be wired into the WebSocket RPC group.
 */

import { Effect } from "effect";
import {
  type FactoryConfig,
  FactoryReadError,
  type FactoryReadSummaryResult,
  type FactoryRegenerateClaudeMdResult,
  FactoryWriteError,
  type ForgeSkillListResult,
  type SessionLog,
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
import { loadForgeSkills } from "./forgeSkills";

const toReadError = (cause: unknown, message: string) =>
  new FactoryReadError({
    message,
    cause,
  });

const toWriteError = (cause: unknown, message: string) =>
  new FactoryWriteError({
    message,
    cause,
  });

export const readFactoryDirectoryEffect = (projectPath: string) =>
  Effect.try({
    try: () => readFactoryDirectory(projectPath),
    catch: (cause) => toReadError(cause, `Failed to read .factory/ at ${projectPath}`),
  });

export const readFactorySummaryEffect = (
  projectPath: string,
): Effect.Effect<FactoryReadSummaryResult, FactoryReadError> =>
  Effect.try({
    try: () => readFactorySummary(projectPath),
    catch: (cause) => toReadError(cause, `Failed to read .factory/ summary at ${projectPath}`),
  });

export const initializeFactoryEffect = (projectPath: string, config: FactoryConfig) =>
  Effect.try({
    try: () => initializeFactory(projectPath, config),
    catch: (cause) => toWriteError(cause, `Failed to initialize .factory/ at ${projectPath}`),
  });

export const writeQueueEffect = (projectPath: string, queue: WorkQueue) =>
  Effect.try({
    try: () => writeQueue(projectPath, queue),
    catch: (cause) => toWriteError(cause, `Failed to write .factory/queue.json at ${projectPath}`),
  });

export const writeSessionLogEffect = (projectPath: string, session: SessionLog) =>
  Effect.try({
    try: () => writeSessionLog(projectPath, session),
    catch: (cause) =>
      toWriteError(cause, `Failed to write .factory/progress session log at ${projectPath}`),
  });

export const listForgeSkillsEffect = (): Effect.Effect<ForgeSkillListResult, FactoryReadError> =>
  Effect.try({
    try: () => loadForgeSkills(),
    catch: (cause) => toReadError(cause, "Failed to load Forge skills"),
  });

export const regenerateClaudeMdEffect = (
  projectPath: string,
): Effect.Effect<FactoryRegenerateClaudeMdResult, FactoryWriteError> =>
  Effect.try({
    try: (): FactoryRegenerateClaudeMdResult => {
      const content = regenerateClaudeMd(projectPath);
      return { content, generatedAt: new Date().toISOString() };
    },
    catch: (cause) =>
      toWriteError(cause, `Failed to regenerate .factory/CLAUDE.md at ${projectPath}`),
  });
