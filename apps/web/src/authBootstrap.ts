import type {
  AuthBootstrapInput,
  AuthBootstrapResult,
  AuthClientMetadata,
  AuthCreatePairingCredentialInput,
  AuthSessionId,
  AuthPairingCredentialResult,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  AuthSessionState,
} from "@t3tools/contracts";
import { resolveServerHttpUrl } from "./lib/utils";

export interface ServerPairingLinkRecord {
  readonly id: string;
  readonly credential: string;
  readonly role: "owner" | "client";
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ServerClientSessionRecord {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly role: "owner" | "client";
  readonly method: "browser-session-cookie" | "bearer-session-token";
  readonly client: AuthClientMetadata;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly connected: boolean;
  readonly current: boolean;
}

export type ServerAuthGateState =
  | { status: "authenticated" }
  | {
      status: "requires-auth";
      auth: AuthSessionState["auth"];
      errorMessage?: string;
    };

let bootstrapPromise: Promise<ServerAuthGateState> | null = null;
const TRANSIENT_AUTH_BOOTSTRAP_STATUS_CODES = new Set([502, 503, 504]);
const AUTH_BOOTSTRAP_RETRY_TIMEOUT_MS = 15_000;
const AUTH_BOOTSTRAP_RETRY_STEP_MS = 500;
const AUTH_SESSION_ESTABLISH_TIMEOUT_MS = 2_000;
const AUTH_SESSION_ESTABLISH_STEP_MS = 100;

class AuthBootstrapHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthBootstrapHttpError";
    this.status = status;
  }
}

export function peekPairingTokenFromUrl(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#")) return null;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("token");
  return token && token.length > 0 ? token : null;
}

export function stripPairingTokenFromUrl() {
  const hash = window.location.hash;
  if (!hash.startsWith("#")) return;
  const params = new URLSearchParams(hash.slice(1));
  if (!params.has("token")) return;
  params.delete("token");
  const remaining = params.toString();
  const url = new URL(window.location.href);
  url.hash = remaining.length > 0 ? remaining : "";
  window.history.replaceState({}, document.title, url.toString());
}

export function takePairingTokenFromUrl(): string | null {
  const token = peekPairingTokenFromUrl();
  if (!token) {
    return null;
  }
  stripPairingTokenFromUrl();
  return token;
}

function getBootstrapCredential(): string | null {
  return getDesktopBootstrapCredential();
}

function getDesktopBootstrapCredential(): string | null {
  const bootstrap = window.desktopBridge?.getLocalEnvironmentBootstrap();
  return typeof bootstrap?.bootstrapToken === "string" && bootstrap.bootstrapToken.length > 0
    ? bootstrap.bootstrapToken
    : null;
}

async function fetchSessionState(): Promise<AuthSessionState> {
  return retryTransientAuthBootstrap(async () => {
    const response = await fetch(resolveServerHttpUrl({ pathname: "/api/auth/session" }), {
      credentials: "include",
    });
    if (!response.ok) {
      throw new AuthBootstrapHttpError(
        `Failed to load auth session state (${response.status}).`,
        response.status,
      );
    }
    return (await response.json()) as AuthSessionState;
  });
}

export async function fetchServerAuthSessionState(): Promise<AuthSessionState> {
  return fetchSessionState();
}

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  return text || fallbackMessage;
}

async function exchangeBootstrapCredential(credential: string): Promise<AuthBootstrapResult> {
  return retryTransientAuthBootstrap(async () => {
    const payload: AuthBootstrapInput = { credential };
    const response = await fetch(resolveServerHttpUrl({ pathname: "/api/auth/bootstrap" }), {
      body: JSON.stringify(payload),
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      const message = await response.text();
      throw new AuthBootstrapHttpError(
        message || `Failed to bootstrap auth session (${response.status}).`,
        response.status,
      );
    }

    return (await response.json()) as AuthBootstrapResult;
  });
}

async function retryTransientAuthBootstrap<T>(operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientAuthBootstrapError(error)) {
        throw error;
      }

      if (Date.now() - startedAt >= AUTH_BOOTSTRAP_RETRY_TIMEOUT_MS) {
        throw error;
      }

      await waitForAuthBootstrapRetry(AUTH_BOOTSTRAP_RETRY_STEP_MS);
    }
  }
}

function isTransientAuthBootstrapError(error: unknown): boolean {
  if (error instanceof AuthBootstrapHttpError) {
    return TRANSIENT_AUTH_BOOTSTRAP_STATUS_CODES.has(error.status);
  }

  if (error instanceof TypeError) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

function waitForAuthBootstrapRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function waitForAuthenticatedSessionAfterBootstrap(): Promise<AuthSessionState> {
  const startedAt = Date.now();

  while (true) {
    const session = await fetchSessionState();
    if (session.authenticated) {
      return session;
    }

    if (Date.now() - startedAt >= AUTH_SESSION_ESTABLISH_TIMEOUT_MS) {
      throw new Error("Timed out waiting for authenticated session after bootstrap.");
    }

    await waitForAuthBootstrapRetry(AUTH_SESSION_ESTABLISH_STEP_MS);
  }
}

async function bootstrapServerAuth(): Promise<ServerAuthGateState> {
  const bootstrapCredential = getBootstrapCredential();
  const currentSession = await fetchSessionState();
  if (currentSession.authenticated) {
    return { status: "authenticated" };
  }

  if (!bootstrapCredential) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
    };
  }

  try {
    await exchangeBootstrapCredential(bootstrapCredential);
    await waitForAuthenticatedSessionAfterBootstrap();
    return { status: "authenticated" };
  } catch (error) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
      errorMessage: error instanceof Error ? error.message : "Authentication failed.",
    };
  }
}

export async function submitServerAuthCredential(credential: string): Promise<void> {
  const trimmedCredential = credential.trim();
  if (!trimmedCredential) {
    throw new Error("Enter a pairing token to continue.");
  }

  await exchangeBootstrapCredential(trimmedCredential);
  bootstrapPromise = null;
  stripPairingTokenFromUrl();
}

export async function createServerPairingCredential(
  label?: string,
): Promise<AuthPairingCredentialResult> {
  const trimmedLabel = label?.trim();
  const payload: AuthCreatePairingCredentialInput = trimmedLabel ? { label: trimmedLabel } : {};
  const response = await fetch(resolveServerHttpUrl({ pathname: "/api/auth/pairing-token" }), {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to create pairing credential (${response.status}).`),
    );
  }

  return (await response.json()) as AuthPairingCredentialResult;
}

export async function listServerPairingLinks(): Promise<ReadonlyArray<ServerPairingLinkRecord>> {
  const response = await fetch(resolveServerHttpUrl({ pathname: "/api/auth/pairing-links" }), {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to load pairing links (${response.status}).`),
    );
  }

  return (await response.json()) as ReadonlyArray<ServerPairingLinkRecord>;
}

export async function revokeServerPairingLink(id: string): Promise<void> {
  const payload: AuthRevokePairingLinkInput = { id };
  const response = await fetch(
    resolveServerHttpUrl({ pathname: "/api/auth/pairing-links/revoke" }),
    {
      body: JSON.stringify(payload),
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to revoke pairing link (${response.status}).`),
    );
  }
}

export async function listServerClientSessions(): Promise<
  ReadonlyArray<ServerClientSessionRecord>
> {
  const response = await fetch(resolveServerHttpUrl({ pathname: "/api/auth/clients" }), {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to load paired clients (${response.status}).`),
    );
  }

  return (await response.json()) as ReadonlyArray<ServerClientSessionRecord>;
}

export async function revokeServerClientSession(sessionId: AuthSessionId): Promise<void> {
  const payload: AuthRevokeClientSessionInput = { sessionId };
  const response = await fetch(resolveServerHttpUrl({ pathname: "/api/auth/clients/revoke" }), {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to revoke client access (${response.status}).`),
    );
  }
}

export async function revokeOtherServerClientSessions(): Promise<number> {
  const response = await fetch(
    resolveServerHttpUrl({ pathname: "/api/auth/clients/revoke-others" }),
    {
      credentials: "include",
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to revoke other clients (${response.status}).`),
    );
  }

  const body = (await response.json()) as { readonly revokedCount: number };
  return body.revokedCount;
}

export function resolveInitialServerAuthGateState(): Promise<ServerAuthGateState> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  const nextBootstrapPromise = bootstrapServerAuth();
  bootstrapPromise = nextBootstrapPromise;
  return nextBootstrapPromise.finally(() => {
    if (bootstrapPromise === nextBootstrapPromise) {
      bootstrapPromise = null;
    }
  });
}

export function __resetServerAuthBootstrapForTests() {
  bootstrapPromise = null;
}
