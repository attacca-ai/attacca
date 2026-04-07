import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { ServerConfigShape } from "../../config.ts";
import { ServerConfig } from "../../config.ts";
import { ServerAuth, type ServerAuthShape } from "../Services/ServerAuth.ts";
import { ServerAuthLive } from "./ServerAuth.ts";
import { ServerSecretStoreLive } from "./ServerSecretStore.ts";

const makeServerConfigLayer = (overrides?: Partial<ServerConfigShape>) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      return {
        ...config,
        ...overrides,
      } satisfies ServerConfigShape;
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-server-test-" })));

const makeServerAuthLayer = (overrides?: Partial<ServerConfigShape>) =>
  ServerAuthLive.pipe(
    Layer.provide(ServerSecretStoreLive),
    Layer.provide(makeServerConfigLayer(overrides)),
  );

const makeCookieRequest = (
  sessionToken: string,
): Parameters<ServerAuthShape["authenticateHttpRequest"]>[0] =>
  ({
    cookies: {
      t3_session: sessionToken,
    },
    headers: {},
  }) as unknown as Parameters<ServerAuthShape["authenticateHttpRequest"]>[0];

it.layer(NodeServices.layer)("ServerAuthLive", (it) => {
  it.effect("issues client pairing credentials by default", () =>
    Effect.gen(function* () {
      const serverAuth = yield* ServerAuth;

      const pairingCredential = yield* serverAuth.issuePairingCredential();
      const exchanged = yield* serverAuth.exchangeBootstrapCredential(pairingCredential.credential);
      const verified = yield* serverAuth.authenticateHttpRequest(
        makeCookieRequest(exchanged.sessionToken),
      );

      expect(verified.role).toBe("client");
      expect(verified.subject).toBe("one-time-token");
    }).pipe(Effect.provide(makeServerAuthLayer())),
  );

  it.effect("issues startup pairing URLs that bootstrap owner sessions", () =>
    Effect.gen(function* () {
      const serverAuth = yield* ServerAuth;

      const pairingUrl = yield* serverAuth.issueStartupPairingUrl("http://127.0.0.1:3773");
      const token = new URL(pairingUrl).searchParams.get("token");
      expect(token).toBeTruthy();

      const exchanged = yield* serverAuth.exchangeBootstrapCredential(token ?? "");
      const verified = yield* serverAuth.authenticateHttpRequest(
        makeCookieRequest(exchanged.sessionToken),
      );

      expect(verified.role).toBe("owner");
      expect(verified.subject).toBe("owner-bootstrap");
    }).pipe(Effect.provide(makeServerAuthLayer())),
  );
});
