import { randomUUID } from "node:crypto";
import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path } from "effect";

import { ServerConfig } from "../../config.ts";
import { ServerEnvironment, type ServerEnvironmentShape } from "../Services/ServerEnvironment.ts";
import { version } from "../../../package.json" with { type: "json" };

const ENVIRONMENT_ID_FILENAME = "environment-id";

function platformOs(): ExecutionEnvironmentDescriptor["platform"]["os"] {
  switch (process.platform) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unknown";
  }
}

function platformArch(): ExecutionEnvironmentDescriptor["platform"]["arch"] {
  switch (process.arch) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x64";
    default:
      return "other";
  }
}

export const makeServerEnvironment = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const environmentIdPath = path.join(serverConfig.stateDir, ENVIRONMENT_ID_FILENAME);

  const readPersistedEnvironmentId = Effect.gen(function* () {
    const exists = yield* fileSystem
      .exists(environmentIdPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return null;
    }

    const raw = yield* fileSystem.readFileString(environmentIdPath).pipe(
      Effect.orElseSucceed(() => ""),
      Effect.map((value) => value.trim()),
    );

    return raw.length > 0 ? raw : null;
  });

  const persistEnvironmentId = (value: string) =>
    fileSystem.writeFileString(environmentIdPath, `${value}\n`);

  const environmentIdRaw = yield* readPersistedEnvironmentId.pipe(
    Effect.flatMap((persisted) => {
      if (persisted) {
        return Effect.succeed(persisted);
      }

      const generated = randomUUID();
      return persistEnvironmentId(generated).pipe(Effect.as(generated));
    }),
  );

  const environmentId = EnvironmentId.makeUnsafe(environmentIdRaw);
  const cwdBaseName = path.basename(serverConfig.cwd).trim();
  const label =
    serverConfig.mode === "desktop"
      ? "Local environment"
      : cwdBaseName.length > 0
        ? cwdBaseName
        : "T3 environment";

  const descriptor: ExecutionEnvironmentDescriptor = {
    environmentId,
    label,
    platform: {
      os: platformOs(),
      arch: platformArch(),
    },
    serverVersion: version,
    capabilities: {
      repositoryIdentity: true,
    },
  };

  return {
    getEnvironmentId: Effect.succeed(environmentId),
    getDescriptor: Effect.succeed(descriptor),
  } satisfies ServerEnvironmentShape;
});

export const ServerEnvironmentLive = Layer.effect(ServerEnvironment, makeServerEnvironment);
