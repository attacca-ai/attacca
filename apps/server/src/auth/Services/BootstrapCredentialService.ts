import type { ServerAuthBootstrapMethod } from "@t3tools/contracts";
import { Data, DateTime, Duration, ServiceMap } from "effect";
import type { Effect } from "effect";

export type BootstrapCredentialRole = "owner" | "client";

export interface BootstrapGrant {
  readonly method: ServerAuthBootstrapMethod;
  readonly role: BootstrapCredentialRole;
  readonly subject: string;
  readonly expiresAt: DateTime.DateTime;
}

export class BootstrapCredentialError extends Data.TaggedError("BootstrapCredentialError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface IssuedBootstrapCredential {
  readonly credential: string;
  readonly expiresAt: DateTime.Utc;
}

export interface BootstrapCredentialServiceShape {
  readonly issueOneTimeToken: (input?: {
    readonly ttl?: Duration.Duration;
    readonly role?: BootstrapCredentialRole;
    readonly subject?: string;
  }) => Effect.Effect<IssuedBootstrapCredential, never>;
  readonly consume: (credential: string) => Effect.Effect<BootstrapGrant, BootstrapCredentialError>;
}

export class BootstrapCredentialService extends ServiceMap.Service<
  BootstrapCredentialService,
  BootstrapCredentialServiceShape
>()("t3/auth/Services/BootstrapCredentialService") {}
