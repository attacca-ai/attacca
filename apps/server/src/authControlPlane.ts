import type {
  AuthClientMetadata,
  AuthClientSession,
  AuthPairingLink,
  AuthSessionId,
} from "@t3tools/contracts";
import { Data, DateTime, Duration, Effect, Layer, ServiceMap } from "effect";

import { BootstrapCredentialServiceLive } from "./auth/Layers/BootstrapCredentialService.ts";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore.ts";
import { SessionCredentialServiceLive } from "./auth/Layers/SessionCredentialService.ts";
import { BootstrapCredentialService } from "./auth/Services/BootstrapCredentialService.ts";
import {
  SessionCredentialService,
  type SessionRole,
} from "./auth/Services/SessionCredentialService.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";

export interface IssuedPairingLink {
  readonly id: string;
  readonly credential: string;
  readonly role: SessionRole;
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
}

export interface IssuedBearerSession {
  readonly sessionId: AuthSessionId;
  readonly token: string;
  readonly method: "bearer-session-token";
  readonly role: SessionRole;
  readonly subject: string;
  readonly client: AuthClientMetadata;
  readonly expiresAt: DateTime.Utc;
}

export class AuthControlPlaneError extends Data.TaggedError("AuthControlPlaneError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface AuthControlPlaneShape {
  readonly createPairingLink: (input?: {
    readonly ttl?: Duration.Duration;
    readonly label?: string;
    readonly role?: SessionRole;
    readonly subject?: string;
  }) => Effect.Effect<IssuedPairingLink, AuthControlPlaneError>;
  readonly listPairingLinks: (input?: {
    readonly role?: SessionRole;
    readonly excludeSubjects?: ReadonlyArray<string>;
  }) => Effect.Effect<ReadonlyArray<AuthPairingLink>, AuthControlPlaneError>;
  readonly revokePairingLink: (id: string) => Effect.Effect<boolean, AuthControlPlaneError>;
  readonly issueSession: (input?: {
    readonly ttl?: Duration.Duration;
    readonly subject?: string;
    readonly role?: SessionRole;
    readonly label?: string;
  }) => Effect.Effect<IssuedBearerSession, AuthControlPlaneError>;
  readonly listSessions: () => Effect.Effect<
    ReadonlyArray<AuthClientSession>,
    AuthControlPlaneError
  >;
  readonly revokeSession: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<boolean, AuthControlPlaneError>;
  readonly revokeOtherSessionsExcept: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<number, AuthControlPlaneError>;
}

export class AuthControlPlane extends ServiceMap.Service<AuthControlPlane, AuthControlPlaneShape>()(
  "t3/AuthControlPlane",
) {}

const DEFAULT_SESSION_SUBJECT = "cli-issued-session";

const bySessionPriority = (left: AuthClientSession, right: AuthClientSession) => {
  if (left.role !== right.role) {
    return left.role === "owner" ? -1 : 1;
  }
  if (left.connected !== right.connected) {
    return left.connected ? -1 : 1;
  }
  return right.issuedAt.epochMilliseconds - left.issuedAt.epochMilliseconds;
};

const toAuthControlPlaneError =
  (message: string) =>
  (cause: unknown): AuthControlPlaneError =>
    new AuthControlPlaneError({
      message,
      cause,
    });

export const makeAuthControlPlane = Effect.gen(function* () {
  const bootstrapCredentials = yield* BootstrapCredentialService;
  const sessions = yield* SessionCredentialService;

  const createPairingLink: AuthControlPlaneShape["createPairingLink"] = (input) =>
    Effect.gen(function* () {
      const createdAt = yield* DateTime.now;
      const issued = yield* bootstrapCredentials.issueOneTimeToken({
        role: input?.role ?? "client",
        subject: input?.subject ?? "one-time-token",
        ...(input?.ttl ? { ttl: input.ttl } : {}),
        ...(input?.label ? { label: input.label } : {}),
      });
      return {
        id: issued.id,
        credential: issued.credential,
        role: input?.role ?? "client",
        subject: input?.subject ?? "one-time-token",
        ...(issued.label ? { label: issued.label } : {}),
        createdAt: DateTime.toUtc(createdAt),
        expiresAt: DateTime.toUtc(issued.expiresAt),
      } satisfies IssuedPairingLink;
    }).pipe(Effect.mapError(toAuthControlPlaneError("Failed to create pairing link.")));

  const listPairingLinks: AuthControlPlaneShape["listPairingLinks"] = (input) =>
    bootstrapCredentials.listActive().pipe(
      Effect.map((pairingLinks) =>
        pairingLinks
          .filter((pairingLink) => (input?.role ? pairingLink.role === input.role : true))
          .filter((pairingLink) => !input?.excludeSubjects?.includes(pairingLink.subject))
          .map((pairingLink) =>
            pairingLink.label
              ? ({
                  id: pairingLink.id,
                  credential: pairingLink.credential,
                  role: pairingLink.role,
                  subject: pairingLink.subject,
                  label: pairingLink.label,
                  createdAt: pairingLink.createdAt,
                  expiresAt: pairingLink.expiresAt,
                } satisfies AuthPairingLink)
              : ({
                  id: pairingLink.id,
                  credential: pairingLink.credential,
                  role: pairingLink.role,
                  subject: pairingLink.subject,
                  createdAt: pairingLink.createdAt,
                  expiresAt: pairingLink.expiresAt,
                } satisfies AuthPairingLink),
          )
          .toSorted(
            (left, right) => right.createdAt.epochMilliseconds - left.createdAt.epochMilliseconds,
          ),
      ),
      Effect.mapError(toAuthControlPlaneError("Failed to list pairing links.")),
    );

  const revokePairingLink: AuthControlPlaneShape["revokePairingLink"] = (id) =>
    bootstrapCredentials
      .revoke(id)
      .pipe(Effect.mapError(toAuthControlPlaneError("Failed to revoke pairing link.")));

  const issueSession: AuthControlPlaneShape["issueSession"] = (input) =>
    sessions
      .issue({
        subject: input?.subject ?? DEFAULT_SESSION_SUBJECT,
        method: "bearer-session-token",
        role: input?.role ?? "owner",
        client: {
          ...(input?.label ? { label: input.label } : {}),
          deviceType: "bot",
        },
        ...(input?.ttl ? { ttl: input.ttl } : {}),
      })
      .pipe(
        Effect.flatMap((issued) => {
          if (issued.method !== "bearer-session-token") {
            return Effect.fail(
              new AuthControlPlaneError({
                message: "CLI session issuance produced an unexpected session method.",
              }),
            );
          }

          return Effect.succeed({
            sessionId: issued.sessionId,
            token: issued.token,
            method: "bearer-session-token" as const,
            role: issued.role,
            subject: input?.subject ?? DEFAULT_SESSION_SUBJECT,
            client: issued.client,
            expiresAt: DateTime.toUtc(issued.expiresAt),
          } satisfies IssuedBearerSession);
        }),
        Effect.mapError(toAuthControlPlaneError("Failed to issue session token.")),
      );

  const listSessions: AuthControlPlaneShape["listSessions"] = () =>
    sessions.listActive().pipe(
      Effect.map((activeSessions) => activeSessions.toSorted(bySessionPriority)),
      Effect.mapError(toAuthControlPlaneError("Failed to list sessions.")),
    );

  const revokeSession: AuthControlPlaneShape["revokeSession"] = (sessionId) =>
    sessions
      .revoke(sessionId)
      .pipe(Effect.mapError(toAuthControlPlaneError("Failed to revoke session.")));

  const revokeOtherSessionsExcept: AuthControlPlaneShape["revokeOtherSessionsExcept"] = (
    sessionId,
  ) =>
    sessions
      .revokeAllExcept(sessionId)
      .pipe(Effect.mapError(toAuthControlPlaneError("Failed to revoke other sessions.")));

  return {
    createPairingLink,
    listPairingLinks,
    revokePairingLink,
    issueSession,
    listSessions,
    revokeSession,
    revokeOtherSessionsExcept,
  } satisfies AuthControlPlaneShape;
});

export const AuthCoreLive = Layer.mergeAll(
  BootstrapCredentialServiceLive,
  SessionCredentialServiceLive,
);

export const AuthStorageLive = Layer.mergeAll(ServerSecretStoreLive, SqlitePersistenceLayerLive);

export const AuthRuntimeLive = AuthCoreLive.pipe(Layer.provideMerge(AuthStorageLive));

export const AuthControlPlaneLive = Layer.effect(AuthControlPlane, makeAuthControlPlane);

export const AuthControlPlaneRuntimeLive = AuthControlPlaneLive.pipe(
  Layer.provideMerge(AuthRuntimeLive),
);
