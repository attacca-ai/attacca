import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ARCO_DEFAULT_MODEL_SELECTION,
  ARCO_RUNTIME_MODE,
  ARCO_THREAD_TITLE,
  buildArcoSessionBootstrap,
} from "./session";
import { ARCO_DEFAULT_SYSTEM_PROMPT } from "./prompt";

describe("arco/session", () => {
  const tempDirs: string[] = [];
  const originalEnv = process.env.ATTACCA_PODIUM_ROOT;

  beforeEach(() => {
    delete process.env.ATTACCA_PODIUM_ROOT;
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (originalEnv === undefined) {
      delete process.env.ATTACCA_PODIUM_ROOT;
    } else {
      process.env.ATTACCA_PODIUM_ROOT = originalEnv;
    }
  });

  const freshPromptPath = (label: string): string => {
    const root = mkdtempSync(join(tmpdir(), `attacca-arco-bootstrap-${label}-`));
    tempDirs.push(root);
    return join(root, "arco-system.md");
  };

  it("returns the read-only runtime mode, Codex default model, and Arco title", () => {
    const path = freshPromptPath("defaults");

    const bootstrap = buildArcoSessionBootstrap({ systemPromptPath: path });

    expect(bootstrap.runtimeMode).toBe(ARCO_RUNTIME_MODE);
    expect(bootstrap.runtimeMode).toBe("read-only");
    expect(bootstrap.modelSelection).toEqual(ARCO_DEFAULT_MODEL_SELECTION);
    expect(bootstrap.title).toBe(ARCO_THREAD_TITLE);
  });

  it("resolves cwd from ATTACCA_PODIUM_ROOT when set", () => {
    const overrideRoot = mkdtempSync(join(tmpdir(), "attacca-podium-override-"));
    tempDirs.push(overrideRoot);
    process.env.ATTACCA_PODIUM_ROOT = overrideRoot;

    const bootstrap = buildArcoSessionBootstrap({
      systemPromptPath: freshPromptPath("env-root"),
    });

    expect(bootstrap.cwd).toBe(overrideRoot);
    expect(bootstrap.cwdSource).toBe("env");
  });

  it("loads system prompt content from the override path (seeded with default)", () => {
    const path = freshPromptPath("prompt-content");

    const bootstrap = buildArcoSessionBootstrap({ systemPromptPath: path });

    expect(bootstrap.systemPromptPath).toBe(path);
    expect(bootstrap.systemPromptContent).toBe(ARCO_DEFAULT_SYSTEM_PROMPT);
  });

  it("passes the persisted session id through to the bootstrap", () => {
    const path = freshPromptPath("existing-session");
    const existingSessionId = "codex-thread-abc-123";

    const bootstrap = buildArcoSessionBootstrap({
      systemPromptPath: path,
      existingSessionId,
    });

    expect(bootstrap.existingSessionId).toBe(existingSessionId);
  });

  it("defaults existingSessionId to null when none is supplied", () => {
    const bootstrap = buildArcoSessionBootstrap({
      systemPromptPath: freshPromptPath("null-session"),
    });

    expect(bootstrap.existingSessionId).toBeNull();
  });

  it("accepts a caller-provided model selection override", () => {
    const bootstrap = buildArcoSessionBootstrap({
      systemPromptPath: freshPromptPath("model-override"),
      modelSelection: { provider: "codex", model: "gpt-5.3-codex" },
    });

    expect(bootstrap.modelSelection).toEqual({ provider: "codex", model: "gpt-5.3-codex" });
  });
});
