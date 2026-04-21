import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { scanProjectsEffect } from "./FactoryRpc";

describe("FactoryRpc scanProjectsEffect", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a warning instead of failing when the root does not exist", async () => {
    const missingRoot = join(tmpdir(), `attacca-missing-${Date.now()}-${Math.random()}`);

    const result = await Effect.runPromise(scanProjectsEffect(missingRoot));

    expect(result.rootDir).toBe(missingRoot);
    expect(result.projects).toEqual([]);
    expect(result.warning).toBe(`Could not scan ${missingRoot} (directory not found).`);
  });

  it("returns no warning for an existing empty directory", async () => {
    const existingRoot = mkdtempSync(join(tmpdir(), "attacca-scan-empty-"));
    tempDirs.push(existingRoot);

    const result = await Effect.runPromise(scanProjectsEffect(existingRoot));

    expect(result.rootDir).toBe(existingRoot);
    expect(result.projects).toEqual([]);
    expect(result.warning).toBeNull();
  });
});
