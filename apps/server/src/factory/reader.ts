/**
 * .factory/ directory reader
 *
 * Reads and parses all files from a project's .factory/ directory.
 * Used by Stand (per-project context) and Podium (multi-project scanning).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import {
  FACTORY_DIR,
  FACTORY_FILES,
  FACTORY_PROTOCOL_VERSION,
  FactoryProtocolVersionError,
  type FactoryConfig,
  type FactoryDirectory,
  type FactoryStatus,
  type WorkQueue,
  type SyncStatus,
  type SessionLog,
} from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// YAML parser (minimal, config.yaml only — no deps)
// ---------------------------------------------------------------------------

/**
 * Decode a YAML double-quoted scalar. Mirrors the writer's yamlQuote escaping:
 * \\ → \, \" → ", \n → newline, \r → CR, \t → tab. Silently strips single
 * quotes on single-quoted scalars (no escape support there — we never emit
 * them from the writer). Leaves bare scalars as-is.
 */
function decodeYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    return inner.replace(/\\(["\\nrt])/g, (_, ch: string) => {
      if (ch === "n") return "\n";
      if (ch === "r") return "\r";
      if (ch === "t") return "\t";
      return ch;
    });
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentArrayKey: string | null = null;
  const currentArray: string[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Array item
    if (trimmed.startsWith("- ") && currentArrayKey) {
      currentArray.push(decodeYamlScalar(trimmed.slice(2)));
      continue;
    }

    // Flush previous array
    if (currentArrayKey) {
      result[currentArrayKey] = [...currentArray];
      currentArrayKey = null;
      currentArray.length = 0;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (!rawValue) {
      // Could be start of array or nested object
      currentArrayKey = key;
      continue;
    }

    // Unquoted bare values: bool / number / fallthrough.
    const wasQuoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    if (!wasQuoted) {
      if (rawValue === "true") {
        result[key] = true;
        continue;
      }
      if (rawValue === "false") {
        result[key] = false;
        continue;
      }
      if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
        result[key] = Number(rawValue);
        continue;
      }
    }
    result[key] = decodeYamlScalar(rawValue);
  }

  // Flush final array
  if (currentArrayKey) {
    result[currentArrayKey] = [...currentArray];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reader functions
// ---------------------------------------------------------------------------

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readTextFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Check whether a parsed config's protocol version is supported. Throws
 * FactoryProtocolVersionError for versions newer than the client supports.
 * Missing version is treated as 1 (backward compat with Phase 1 configs).
 */
function coerceVersion(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

function assertSupportedVersion(
  config: { version?: unknown },
  projectPath: string,
): number {
  const found = coerceVersion(config.version);
  if (found > FACTORY_PROTOCOL_VERSION) {
    throw new FactoryProtocolVersionError({
      message: `This project uses .factory/ protocol v${found} but this Attacca client supports up to v${FACTORY_PROTOCOL_VERSION}. Update Attacca or downgrade the project.`,
      foundVersion: found,
      supportedVersion: FACTORY_PROTOCOL_VERSION,
      projectPath,
    });
  }
  return found;
}

function readConfig(factoryPath: string, projectPath: string): FactoryConfig | null {
  const configPath = join(factoryPath, FACTORY_FILES.CONFIG);
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseSimpleYaml(raw);
  const version = assertSupportedVersion(parsed, projectPath);
  return { ...parsed, version } as unknown as FactoryConfig;
}

function readSessions(factoryPath: string): SessionLog[] {
  const progressDir = join(factoryPath, FACTORY_FILES.PROGRESS_DIR);
  if (!existsSync(progressDir)) return [];

  try {
    const files = readdirSync(progressDir)
      .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 10); // Last 10 sessions

    return files
      .map((f) => readJsonFile<SessionLog>(join(progressDir, f)))
      .filter((s): s is SessionLog => s !== null);
  } catch {
    return [];
  }
}

/**
 * Read the full .factory/ directory for a project.
 */
export function readFactoryDirectory(projectPath: string): FactoryDirectory {
  const factoryPath = join(projectPath, FACTORY_DIR);
  const exists = existsSync(factoryPath);

  if (!exists) {
    return {
      exists: false,
      path: factoryPath,
      config: null,
      status: null,
      queue: null,
      syncStatus: null,
      specContent: null,
      contextContent: null,
      intentContract: null,
      scenarios: null,
      sessions: [],
      claudeMd: null,
    };
  }

  return {
    exists: true,
    path: factoryPath,
    config: readConfig(factoryPath, projectPath),
    status: readJsonFile<FactoryStatus>(join(factoryPath, FACTORY_FILES.STATUS)),
    queue: readJsonFile<WorkQueue>(join(factoryPath, FACTORY_FILES.QUEUE)),
    syncStatus: readJsonFile<SyncStatus>(join(factoryPath, FACTORY_FILES.SYNC_STATUS)),
    specContent: readTextFile(join(factoryPath, FACTORY_FILES.SPEC)),
    contextContent: readTextFile(join(factoryPath, FACTORY_FILES.CONTEXT)),
    intentContract: readTextFile(join(factoryPath, FACTORY_FILES.INTENT_CONTRACT)),
    scenarios: readTextFile(join(factoryPath, FACTORY_FILES.SCENARIOS)),
    sessions: readSessions(factoryPath),
    claudeMd: readTextFile(join(factoryPath, FACTORY_FILES.CLAUDE_MD)),
  };
}

/**
 * Check if a directory has a .factory/ directory (quick check for scanning).
 */
export function hasFactoryDir(projectPath: string): boolean {
  return existsSync(join(projectPath, FACTORY_DIR));
}

/**
 * Quick read: just config + status (for dashboard listing).
 */
export function readFactorySummary(
  projectPath: string,
): { config: FactoryConfig | null; status: FactoryStatus | null } {
  const factoryPath = join(projectPath, FACTORY_DIR);
  return {
    config: readConfig(factoryPath, projectPath),
    status: readJsonFile<FactoryStatus>(join(factoryPath, FACTORY_FILES.STATUS)),
  };
}
