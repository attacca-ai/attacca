import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Runtime canonical default for Arco's developer instructions. The Arco
 * bootstrap seeds `~/.attacca/arco-system.md` with this content on first
 * launch and re-seeds when the operator clicks "Restore default prompt"
 * in settings. Mirrors `docs/arco-system-prompt.md` — that file is the
 * human-facing reference; this constant is what the server actually
 * injects into `collaborationMode.settings.developer_instructions` at
 * turn time. Keep them in sync.
 */
export const ARCO_DEFAULT_SYSTEM_PROMPT = `# Arco — Factory operator

You are Arco, a read-only assistant for the Attacca operator. Your sole
surface is a chat over the Podium root. The Codex sandbox blocks every
write — you physically cannot mutate the filesystem, dispatch work
packages, invoke skills, or push to git remotes. Do not pretend
otherwise.

## Scope

- Inspect \`.factory/\` metadata across the operator's projects.
- Read git state (\`git log\`, \`git diff\`, \`git status\`, \`git branch -vv\`).
- Summarize, triage, and explain findings across the full factory.
- When the operator needs a mutating action (dispatch, push, skill run),
  surface the exact shell commands and point them at Podium / their
  editor. Never execute those commands yourself.

## Behavior

- Reach for shell + file-read first. Only ask the operator when the
  answer genuinely cannot be discovered.
- Keep responses short and decision-oriented. The operator is scanning,
  not reading essays.
- If a tool call fails because the sandbox rejected a write, say so
  plainly and suggest the command the operator should run instead.
- If git is missing or a project has no \`.factory/\`, say that directly
  rather than guessing.

## Non-behaviors

- No proactive nudges, digests, or background polling.
- No speculative code review beyond what the operator asks for.
- No fabricated file paths or commit hashes. If you do not know, say so.
`;

const DEFAULT_ARCO_HOME_DIR = ".attacca";
const DEFAULT_ARCO_PROMPT_FILENAME = "arco-system.md";

/**
 * Resolve the filesystem path for the Arco system prompt. Defaults to
 * `~/.attacca/arco-system.md`. Accepts an explicit override (from the
 * `arcoSystemPromptPath` client setting, introduced in task 6) — when
 * provided it is returned verbatim, letting operators point Arco at a
 * shared prompt file. The `ATTACCA_ARCO_PROMPT_PATH` env var overrides
 * the default location when no explicit override is passed.
 */
export function resolveArcoSystemPromptPath(override?: string | null): string {
  const trimmed = override?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }
  const envOverride = process.env["ATTACCA_ARCO_PROMPT_PATH"]?.trim();
  if (envOverride && envOverride.length > 0) {
    return envOverride;
  }
  return join(homedir(), DEFAULT_ARCO_HOME_DIR, DEFAULT_ARCO_PROMPT_FILENAME);
}

/**
 * Ensure the Arco system prompt file exists at the given path. Creates
 * the parent directory and seeds the file with {@link ARCO_DEFAULT_SYSTEM_PROMPT}
 * when missing. Never overwrites an existing file — operators can hand-edit
 * their prompt without fear of losing changes on the next launch.
 * Returns the resolved absolute path.
 */
export function ensureArcoSystemPrompt(input?: {
  readonly path?: string | null;
  readonly defaultContent?: string;
}): string {
  const target = resolveArcoSystemPromptPath(input?.path);
  if (!existsSync(target)) {
    const parent = dirname(target);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    writeFileSync(target, input?.defaultContent ?? ARCO_DEFAULT_SYSTEM_PROMPT, "utf-8");
  }
  return target;
}

/**
 * Load the Arco system prompt content from disk. Ensures the file first
 * (creating from the default template if missing) so callers never have
 * to handle a missing-file case.
 */
export function loadArcoSystemPrompt(input?: {
  readonly path?: string | null;
  readonly defaultContent?: string;
}): { readonly path: string; readonly content: string } {
  const path = ensureArcoSystemPrompt(input);
  const content = readFileSync(path, "utf-8");
  return { path, content };
}

/**
 * Overwrite the Arco system prompt file with the default template. Used
 * by the "Restore default prompt" settings action (task 6).
 */
export function restoreArcoSystemPrompt(input?: {
  readonly path?: string | null;
  readonly defaultContent?: string;
}): string {
  const target = resolveArcoSystemPromptPath(input?.path);
  const parent = dirname(target);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(target, input?.defaultContent ?? ARCO_DEFAULT_SYSTEM_PROMPT, "utf-8");
  return target;
}
