import type {
  AuthBootstrapResult,
  AuthPairingCredentialResult,
  AuthSessionState,
  ServerAuthDescriptor,
  ServerAuthSessionMethod,
} from "@t3tools/contracts";
import { Data, DateTime, ServiceMap } from "effect";
import type { Effect } from "effect";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import type { SessionRole } from "./SessionCredentialService.ts";

export interface AuthenticatedSession {
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
  readonly role: SessionRole;
  readonly expiresAt?: DateTime.DateTime;
}

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly status?: 401 | 403;
  readonly cause?: unknown;
}> {}

export interface ServerAuthShape {
  readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
  readonly getSessionState: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthSessionState, never>;
  readonly exchangeBootstrapCredential: (credential: string) => Effect.Effect<
    {
      readonly response: AuthBootstrapResult;
      readonly sessionToken: string;
    },
    AuthError
  >;
  readonly issuePairingCredential: (input?: {
    readonly role?: SessionRole;
  }) => Effect.Effect<AuthPairingCredentialResult, never>;
  readonly authenticateHttpRequest: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthenticatedSession, AuthError>;
  readonly authenticateWebSocketUpgrade: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<AuthenticatedSession, AuthError>;
  readonly issueStartupPairingUrl: (baseUrl: string) => Effect.Effect<string, never>;
}

export class ServerAuth extends ServiceMap.Service<ServerAuth, ServerAuthShape>()(
  "t3/auth/Services/ServerAuth",
) {}
