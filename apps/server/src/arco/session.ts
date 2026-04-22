import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  type RuntimeMode,
} from "@t3tools/contracts";
import { resolvePodiumRoot } from "../factory/allowedRoots";
import { loadArcoSystemPrompt } from "./prompt";

/**
 * Arco runs as a singleton, durable thread bound to the operator rather
 * than to any single project (spec §D1). The title is what shows up in
 * the sidebar if Arco ever surfaces there.
 */
export const ARCO_THREAD_TITLE = "Arco";

/**
 * Arco is Codex-only in v0 (spec §D2). The Codex sandbox is what
 * enforces read-only behavior; the Claude adapter has no equivalent
 * guarantee today, so we do not even offer it as a choice.
 */
export const ARCO_DEFAULT_MODEL_SELECTION: ModelSelection = {
  provider: "codex",
  model: DEFAULT_MODEL_BY_PROVIDER.codex,
};

/**
 * Arco always runs in read-only sandbox mode, with approvals disabled
 * so routine `git log` / `cat` / `ls` calls do not interrupt the
 * operator (spec §D4 + scenario 7).
 */
export const ARCO_RUNTIME_MODE: RuntimeMode = "read-only";

/**
 * Fully resolved parameters for starting (or resuming) the Arco Codex
 * session. Task 3 feeds this into the `/arco` route handler / WS
 * bootstrap flow which, in turn, dispatches a `thread.create` command
 * through the normal orchestration pipeline.
 *
 * `systemPromptContent` is the raw text loaded from
 * `~/.attacca/arco-system.md` (or the `arcoSystemPromptPath` override).
 * Task 3 is responsible for threading it into
 * `collaborationMode.settings.developer_instructions` on every turn —
 * the underlying plumbing lives in
 * `apps/server/src/codexAppServerManager.ts`.
 */
export interface ArcoSessionBootstrap {
  readonly cwd: string;
  readonly cwdSource: "env" | "default";
  readonly runtimeMode: RuntimeMode;
  readonly modelSelection: ModelSelection;
  readonly title: string;
  readonly systemPromptPath: string;
  readonly systemPromptContent: string;
  /**
   * Previously persisted Codex session id (the operator's `arcoSessionId`
   * client setting). When present, the caller should try to resume that
   * session; when `null` or the resume fails, a fresh thread is created
   * and the new session id gets persisted back to the setting.
   */
  readonly existingSessionId: string | null;
}

/**
 * Build the Arco session bootstrap context. Pure apart from:
 *  1. reading the Podium root env var, and
 *  2. ensuring `~/.attacca/arco-system.md` exists and loading its
 *     content.
 *
 * Does not start any Codex process, does not touch the orchestration
 * engine, does not read client settings — callers pass in the
 * previously persisted session id (if any) and handle persistence
 * themselves.
 */
export function buildArcoSessionBootstrap(input?: {
  readonly existingSessionId?: string | null;
  readonly modelSelection?: ModelSelection;
  readonly systemPromptPath?: string | null;
}): ArcoSessionBootstrap {
  const podium = resolvePodiumRoot();
  const prompt = loadArcoSystemPrompt({
    path: input?.systemPromptPath ?? null,
  });
  return {
    cwd: podium.rootDir,
    cwdSource: podium.source,
    runtimeMode: ARCO_RUNTIME_MODE,
    modelSelection: input?.modelSelection ?? ARCO_DEFAULT_MODEL_SELECTION,
    title: ARCO_THREAD_TITLE,
    systemPromptPath: prompt.path,
    systemPromptContent: prompt.content,
    existingSessionId: input?.existingSessionId ?? null,
  };
}
