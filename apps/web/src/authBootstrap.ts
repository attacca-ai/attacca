import type {
  AuthBootstrapInput,
  AuthBootstrapResult,
  AuthPairingCredentialResult,
  AuthSessionState,
} from "@t3tools/contracts";
import { resolveServerHttpUrl } from "./lib/utils";

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

class AuthBootstrapHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthBootstrapHttpError";
    this.status = status;
  }
}

export function peekPairingTokenFromUrl(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  return token && token.length > 0 ? token : null;
}

export function stripPairingTokenFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("token")) {
    return;
  }
  url.searchParams.delete("token");
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

export async function createServerPairingCredential(): Promise<AuthPairingCredentialResult> {
  const response = await fetch(resolveServerHttpUrl({ pathname: "/api/auth/pairing-token" }), {
    credentials: "include",
    method: "POST",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to create pairing credential (${response.status}).`);
  }

  return (await response.json()) as AuthPairingCredentialResult;
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
