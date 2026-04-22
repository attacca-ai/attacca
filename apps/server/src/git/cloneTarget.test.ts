import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deriveCloneDirectoryName,
  resolveCloneTargetPath,
  sanitizeCloneDirectoryName,
} from "./cloneTarget";

describe("cloneTarget", () => {
  it("derives the clone directory name from https URLs", () => {
    expect(deriveCloneDirectoryName({ url: "https://github.com/acme/widget-service.git" })).toBe(
      "widget-service",
    );
  });

  it("derives the clone directory name from ssh-style URLs", () => {
    expect(deriveCloneDirectoryName({ url: "git@github.com:acme/widget-service.git" })).toBe(
      "widget-service",
    );
  });

  it("prefers an explicit directory name", () => {
    expect(
      deriveCloneDirectoryName({
        url: "https://github.com/acme/widget-service.git",
        directoryName: "client widget",
      }),
    ).toBe("client-widget");
  });

  it("sanitizes problematic directory names", () => {
    expect(sanitizeCloneDirectoryName("  repo name!.git  ")).toBe("repo-name");
  });

  it("builds the final project path", () => {
    expect(
      resolveCloneTargetPath({
        destinationParent: "/tmp/podium",
        url: "https://github.com/acme/widget-service.git",
      }),
    ).toEqual({
      directoryName: "widget-service",
      projectPath: join("/tmp/podium", "widget-service"),
    });
  });
});
