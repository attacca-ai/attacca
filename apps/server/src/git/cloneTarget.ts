import { join } from "node:path";

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}

function extractCloneNameSource(url: string): string {
  const trimmed = url.trim().replace(/[\\/]+$/, "");
  if (trimmed.length === 0) {
    return "";
  }

  const sshLikeMatch = /^[^@]+@[^:]+:(.+)$/.exec(trimmed);
  if (sshLikeMatch?.[1]) {
    return sshLikeMatch[1];
  }

  try {
    return new URL(trimmed).pathname;
  } catch {
    return trimmed;
  }
}

export function sanitizeCloneDirectoryName(value: string): string {
  return stripGitSuffix(value.trim())
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveCloneDirectoryName(input: {
  readonly url: string;
  readonly directoryName?: string | undefined;
}): string {
  const explicitName = input.directoryName?.trim();
  const rawCandidate =
    explicitName && explicitName.length > 0
      ? explicitName
      : (extractCloneNameSource(input.url)
          .split(/[\\/]/)
          .findLast((part) => part.length > 0) ?? "");
  const sanitized = sanitizeCloneDirectoryName(rawCandidate);

  if (sanitized.length > 0) {
    return sanitized;
  }

  throw new Error(`Could not derive a clone directory name from ${input.url}`);
}

export function resolveCloneTargetPath(input: {
  readonly destinationParent: string;
  readonly url: string;
  readonly directoryName?: string | undefined;
}): {
  readonly directoryName: string;
  readonly projectPath: string;
} {
  const directoryName = deriveCloneDirectoryName(input);
  return {
    directoryName,
    projectPath: join(input.destinationParent, directoryName),
  };
}
