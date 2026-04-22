import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ARCO_DEFAULT_SYSTEM_PROMPT,
  ensureArcoSystemPrompt,
  loadArcoSystemPrompt,
  resolveArcoSystemPromptPath,
  restoreArcoSystemPrompt,
} from "./prompt";

describe("arco/prompt", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const freshPromptPath = (label: string): string => {
    const root = mkdtempSync(join(tmpdir(), `attacca-arco-${label}-`));
    tempDirs.push(root);
    return join(root, "nested", "arco-system.md");
  };

  it("resolveArcoSystemPromptPath honors an explicit override", () => {
    const override = "/tmp/custom-arco.md";
    expect(resolveArcoSystemPromptPath(override)).toBe(override);
  });

  it("resolveArcoSystemPromptPath falls back to ~/.attacca/arco-system.md when override blank", () => {
    const resolved = resolveArcoSystemPromptPath("  ");
    expect(resolved.endsWith(join(".attacca", "arco-system.md"))).toBe(true);
  });

  it("ensureArcoSystemPrompt creates the parent dir and seeds the default template when missing", () => {
    const path = freshPromptPath("ensure-create");

    const result = ensureArcoSystemPrompt({ path });

    expect(result).toBe(path);
    expect(readFileSync(path, "utf-8")).toBe(ARCO_DEFAULT_SYSTEM_PROMPT);
  });

  it("ensureArcoSystemPrompt is idempotent and never overwrites existing content", () => {
    const path = freshPromptPath("ensure-preserve");
    ensureArcoSystemPrompt({ path });
    const hand_edit = "# My custom Arco prompt\n\nDo only what I tell you.\n";
    writeFileSync(path, hand_edit, "utf-8");

    ensureArcoSystemPrompt({ path });

    expect(readFileSync(path, "utf-8")).toBe(hand_edit);
  });

  it("loadArcoSystemPrompt returns the content of the ensured file", () => {
    const path = freshPromptPath("load");

    const result = loadArcoSystemPrompt({ path });

    expect(result.path).toBe(path);
    expect(result.content).toBe(ARCO_DEFAULT_SYSTEM_PROMPT);
  });

  it("loadArcoSystemPrompt reads hand-edited content", () => {
    const path = freshPromptPath("load-edited");
    const custom = "# Edited\n";
    ensureArcoSystemPrompt({ path });
    writeFileSync(path, custom, "utf-8");

    const result = loadArcoSystemPrompt({ path });

    expect(result.content).toBe(custom);
  });

  it("restoreArcoSystemPrompt overwrites any existing content with the default template", () => {
    const path = freshPromptPath("restore");
    ensureArcoSystemPrompt({ path });
    writeFileSync(path, "# stale\n", "utf-8");

    const result = restoreArcoSystemPrompt({ path });

    expect(result).toBe(path);
    expect(readFileSync(path, "utf-8")).toBe(ARCO_DEFAULT_SYSTEM_PROMPT);
  });

  it("restoreArcoSystemPrompt writes to a fresh path when no file exists yet", () => {
    const path = freshPromptPath("restore-fresh");

    restoreArcoSystemPrompt({ path });

    expect(readFileSync(path, "utf-8")).toBe(ARCO_DEFAULT_SYSTEM_PROMPT);
  });

  it("accepts a custom default content override", () => {
    const path = freshPromptPath("custom-default");
    const defaultContent = "# Override default\n";

    const result = loadArcoSystemPrompt({ path, defaultContent });

    expect(result.content).toBe(defaultContent);
  });
});
