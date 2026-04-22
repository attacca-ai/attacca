import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FactoryPathError,
  type GitCloneRepositoryInput,
  type GitCloneRepositoryResult,
} from "@t3tools/contracts";

import { cloneRepositoryEffect } from "./GitRpc";
import { GitCore, type GitCoreShape } from "./Services/GitCore";

const cloneRepository =
  vi.fn<(input: GitCloneRepositoryInput) => Effect.Effect<GitCloneRepositoryResult, never>>();

const TestLayer = Layer.succeed(GitCore, {
  cloneRepository,
} as unknown as GitCoreShape);

describe("cloneRepositoryEffect", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ATTACCA_PODIUM_ROOT;
  });

  it("delegates to GitCore when the clone destination is allowed", async () => {
    process.env.ATTACCA_PODIUM_ROOT = "C:/podium";
    cloneRepository.mockReturnValue(
      Effect.succeed({
        directoryName: "widget-service",
        projectPath: "C:/podium/widget-service",
      }),
    );

    const result = await Effect.runPromise(
      cloneRepositoryEffect({
        url: "https://github.com/acme/widget-service.git",
        destinationParent: "C:/podium",
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result).toEqual({
      directoryName: "widget-service",
      projectPath: "C:/podium/widget-service",
    });
    expect(cloneRepository).toHaveBeenCalledWith({
      url: "https://github.com/acme/widget-service.git",
      destinationParent: "C:/podium",
    });
  });

  it("rejects clone destinations outside the allowed roots", async () => {
    process.env.ATTACCA_PODIUM_ROOT = "C:/podium";

    await expect(
      Effect.runPromise(
        cloneRepositoryEffect({
          url: "https://github.com/acme/widget-service.git",
          destinationParent: "D:/elsewhere",
        }).pipe(Effect.provide(TestLayer)),
      ),
    ).rejects.toBeInstanceOf(FactoryPathError);

    expect(cloneRepository).not.toHaveBeenCalled();
  });
});
