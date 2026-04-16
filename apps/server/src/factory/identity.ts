/**
 * Identity bootstrap for Attacca.
 *
 * Reads `git config --global user.name`, falling back to the OS username,
 * then to null. Only runs synchronously per RPC call — the web client is
 * expected to cache the result in client settings and not re-query.
 */

import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

import type { GitIdentityResult } from "@t3tools/contracts";

function readGitName(): string | null {
  try {
    const output = execFileSync("git", ["config", "--global", "user.name"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function readOsName(): string | null {
  try {
    const name = userInfo().username;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

export function resolveGitIdentity(): GitIdentityResult {
  const fromGit = readGitName();
  if (fromGit) return { name: fromGit, source: "git" };

  const fromOs = readOsName();
  if (fromOs) return { name: fromOs, source: "os" };

  return { name: null, source: "none" };
}
