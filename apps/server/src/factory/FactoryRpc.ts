/**
 * Effect wrappers for .factory/ reader/writer.
 *
 * The underlying reader/writer are plain sync Node fs functions. This module
 * lifts them into Effects tagged with FactoryReadError / FactoryWriteError so
 * they can be wired into the WebSocket RPC group.
 */

import { Effect, Schema } from "effect";
import {
  type FactoryConfig,
  type FactoryDirectory,
  FactoryProtocolVersionError,
  FactoryReadError,
  type FactoryReadSummaryResult,
  type FactoryRegenerateClaudeMdResult,
  FactoryWriteError,
  type ForgeSkillListResult,
  type GitIdentityResult,
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
import { resolveGitIdentity } from "./identity";

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

export const readFactoryDirectoryEffect = (
  projectPath: string,
): Effect.Effect<FactoryDirectory, FactoryReadError | FactoryProtocolVersionError> =>
  Effect.try({
    try: () => readFactoryDirectory(projectPath),
    catch: (cause) => toReadOrProtocolError(cause, `Failed to read .factory/ at ${projectPath}`),
  });

export const readFactorySummaryEffect = (
  projectPath: string,
): Effect.Effect<
  FactoryReadSummaryResult,
  FactoryReadError | FactoryProtocolVersionError
> =>
  Effect.try({
    try: () => readFactorySummary(projectPath),
    catch: (cause) =>
      toReadOrProtocolError(cause, `Failed to read .factory/ summary at ${projectPath}`),
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
    catch: (cause) => new FactoryReadError({ message: "Failed to load Forge skills", cause }),
  });

export const getGitIdentityEffect = (): Effect.Effect<GitIdentityResult, never> =>
  Effect.sync(() => resolveGitIdentity());

export const regenerateClaudeMdEffect = (
  projectPath: string,
): Effect.Effect<
  FactoryRegenerateClaudeMdResult,
  FactoryWriteError | FactoryProtocolVersionError
> =>
  Effect.try({
    try: (): FactoryRegenerateClaudeMdResult => {
      const content = regenerateClaudeMd(projectPath);
      return { content, generatedAt: new Date().toISOString() };
    },
    catch: (cause) => {
      if (isProtocolVersionError(cause)) return cause;
      return toWriteError(cause, `Failed to regenerate .factory/CLAUDE.md at ${projectPath}`);
    },
  });
