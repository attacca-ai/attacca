import { homedir, platform as osPlatform } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { FactoryPathError, type PodiumRootResult } from "@t3tools/contracts";

/**
 * Resolve the Podium scan root. Reads `ATTACCA_PODIUM_ROOT` first, falls back
 * to `~/projects` on the server host. Callers can still pass an explicit
 * `rootDir` via the scanProjects RPC to override both.
 */
export function resolvePodiumRoot(): PodiumRootResult {
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
 * Check whether `normalizedProject` is a subpath of `normalizedRoot`.
 */
function isSubpath(normalizedProject: string, normalizedRoot: string): boolean {
  if (normalizedProject === normalizedRoot) return true;
  const fwdPrefix = normalizedRoot + "/";
  if (normalizedProject.startsWith(fwdPrefix)) return true;
  const nativePrefix = normalizedRoot + sep;
  return PATH_CASE_SENSITIVE
    ? normalizedProject.startsWith(nativePrefix)
    : normalizedProject.startsWith(nativePrefix.toLowerCase());
}

/**
 * Assert that `projectPath` is inside the resolved Podium scan root OR
 * inside any of the extra allowed roots passed by the client (the
 * `externalIntakeRoots` setting). Throws FactoryPathError if none match.
 */
export function assertPathInsideAllowedRoot(
  projectPath: string,
  extraRoots?: ReadonlyArray<string>,
): void {
  const { rootDir } = resolvePodiumRoot();
  const normalizedProject = normalizePathForCompare(projectPath);

  if (isSubpath(normalizedProject, normalizePathForCompare(rootDir))) return;

  if (extraRoots) {
    for (const extra of extraRoots) {
      if (extra.trim().length === 0) continue;
      if (isSubpath(normalizedProject, normalizePathForCompare(extra))) return;
    }
  }

  throw new FactoryPathError({
    message: `Refusing to write outside allowed roots. Project path ${projectPath} is not inside ${rootDir} or any intake root.`,
    projectPath,
    scanRoot: rootDir,
  });
}
