export interface WaitForHttpReadyOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 100;

export class BackendReadinessAbortedError extends Error {
  constructor() {
    super("Backend readiness wait was aborted.");
    this.name = "BackendReadinessAbortedError";
  }
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new BackendReadinessAbortedError());
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal?.aborted) {
      cleanup();
      reject(new BackendReadinessAbortedError());
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isBackendReadinessAborted(error: unknown): error is BackendReadinessAbortedError {
  return error instanceof BackendReadinessAbortedError;
}

export async function waitForHttpReady(
  baseUrl: string,
  options?: WaitForHttpReadyOptions,
): Promise<void> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const signal = options?.signal;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (signal?.aborted) {
      throw new BackendReadinessAbortedError();
    }

    try {
      const response = await fetchImpl(`${baseUrl}/api/auth/session`, {
        redirect: "manual",
        ...(signal ? { signal } : {}),
      });
      if (response.ok) {
        return;
      }
    } catch (error) {
      if (isBackendReadinessAborted(error)) {
        throw error;
      }
      if (signal?.aborted) {
        throw new BackendReadinessAbortedError();
      }
      // Retry until the backend becomes reachable or the deadline expires.
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for backend readiness at ${baseUrl}.`);
    }

    await delay(intervalMs, signal);
  }
}
