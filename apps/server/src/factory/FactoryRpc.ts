/**
 * Effect wrappers for .factory/ reader/writer.
 *
 * The underlying reader/writer are plain sync Node fs functions. This module
 * lifts them into Effects tagged with FactoryReadError / FactoryWriteError so
 * they can be wired into the WebSocket RPC group.
 */

import { Effect, Schema } from "effect";
import { homedir, platform as osPlatform } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
  type FactoryConfig,
  type FactoryDirectory,
  FactoryPathError,
  FactoryProtocolVersionError,
  FactoryReadError,
  type FactoryReadSummaryResult,
  type FactoryRegenerateClaudeMdResult,
  FactoryWriteError,
  type ForgeSkillListResult,
  type GitIdentityResult,
  type PodiumRootResult,
  type ScanProjectsResult,
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
import { scanProjects } from "../scanner";

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
): Effect.Effect<
  FactoryReadSummaryResult,
  FactoryReadError | FactoryProtocolVersionError
> =>
  Effect.try({
    try: () => readFactorySummary(projectPath),
    catch: (cause) =>
      toReadOrProtocolError(cause, `Failed to read .factory/ summary at ${projectPath}`),
  });

export const initializeFactoryEffect = (
  projectPath: string,
  config: FactoryConfig,
): Effect.Effect<void, FactoryWriteError | FactoryPathError> =>
  Effect.try({
    try: () => {
      assertPathInsideScanRoot(projectPath);
      initializeFactory(projectPath, config);
    },
    catch: (cause) =>
      toWriteOrPathError(cause, `Failed to initialize .factory/ at ${projectPath}`),
  });

export const writeQueueEffect = (
  projectPath: string,
  queue: WorkQueue,
): Effect.Effect<void, FactoryWriteError | FactoryPathError> =>
  Effect.try({
    try: () => {
      assertPathInsideScanRoot(projectPath);
      writeQueue(projectPath, queue);
    },
    catch: (cause) =>
      toWriteOrPathError(cause, `Failed to write .factory/queue.json at ${projectPath}`),
  });

export const writeSessionLogEffect = (
  projectPath: string,
  session: SessionLog,
): Effect.Effect<void, FactoryWriteError | FactoryPathError> =>
  Effect.try({
    try: () => {
      assertPathInsideScanRoot(projectPath);
      writeSessionLog(projectPath, session);
    },
    catch: (cause) =>
      toWriteOrPathError(
        cause,
        `Failed to write .factory/progress session log at ${projectPath}`,
      ),
  });

export const listForgeSkillsEffect = (): Effect.Effect<ForgeSkillListResult, FactoryReadError> =>
  Effect.try({
    try: () => loadForgeSkills(),
    catch: (cause) => new FactoryReadError({ message: "Failed to load Forge skills", cause }),
  });

export const getGitIdentityEffect = (): Effect.Effect<GitIdentityResult, never> =>
  Effect.sync(() => resolveGitIdentity());

/**
 * Resolve the Podium scan root. Reads `ATTACCA_PODIUM_ROOT` first, falls back
 * to `~/projects` on the server host. Callers can still pass an explicit
 * `rootDir` via the scanProjects RPC to override both.
 */
function resolvePodiumRoot(): PodiumRootResult {
  const fromEnv = process.env.ATTACCA_PODIUM_ROOT?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return { rootDir: fromEnv, source: "env" };
  }
  return { rootDir: join(homedir(), "projects"), source: "default" };
}

const PATH_CASE_SENSITIVE = osPlatform() !== "win32" && osPlatform() !== "darwin";

function normalizePathForCompare(value: string): string {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(value);
  const trimmed = absolute.replace(/[\\/]+$/, "");
  return PATH_CASE_SENSITIVE ? trimmed : trimmed.toLowerCase();
}

/**
 * Assert that `projectPath` is inside the resolved Podium scan root.
 * Defense-in-depth against arbitrary writes via the WebSocket boundary —
 * the spec explicitly accepts "no auth", but write RPCs should still
 * refuse paths outside the factory surface. Throws FactoryPathError.
 */
function assertPathInsideScanRoot(projectPath: string): void {
  const { rootDir } = resolvePodiumRoot();
  const normalizedRoot = normalizePathForCompare(rootDir);
  const normalizedProject = normalizePathForCompare(projectPath);
  if (normalizedProject === normalizedRoot) return;
  if (!normalizedProject.startsWith(normalizedRoot + sep.replace(/\\/g, "/"))) {
    // Also try native-sep comparison in case the resolve() above produced
    // a path with native separators.
    const nativePrefix = normalizedRoot + sep;
    if (!normalizedProject.startsWith(nativePrefix.toLowerCase())) {
      throw new FactoryPathError({
        message: `Refusing to write outside the Podium scan root. Project path ${projectPath} is not inside ${rootDir}.`,
        projectPath,
        scanRoot: rootDir,
      });
    }
  }
}

const isFactoryPathError = Schema.is(FactoryPathError);

export const getPodiumRootEffect = (): Effect.Effect<PodiumRootResult, never> =>
  Effect.sync(() => resolvePodiumRoot());

export const scanProjectsEffect = (
  rootDir: string | undefined,
): Effect.Effect<ScanProjectsResult, FactoryReadError> =>
  Effect.try({
    try: (): ScanProjectsResult => {
      const effectiveRoot = rootDir?.trim() || resolvePodiumRoot().rootDir;
      return {
        rootDir: effectiveRoot,
        projects: scanProjects(effectiveRoot),
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
): Effect.Effect<
  FactoryRegenerateClaudeMdResult,
  FactoryWriteError | FactoryProtocolVersionError | FactoryPathError
> =>
  Effect.try({
    try: (): FactoryRegenerateClaudeMdResult => {
      assertPathInsideScanRoot(projectPath);
      const content = regenerateClaudeMd(projectPath);
      return { content, generatedAt: new Date().toISOString() };
    },
    catch: (cause) => {
      if (isProtocolVersionError(cause)) return cause;
      if (isFactoryPathError(cause)) return cause;
      return toWriteError(cause, `Failed to regenerate .factory/CLAUDE.md at ${projectPath}`);
    },
  });
