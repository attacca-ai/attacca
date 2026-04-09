import type { AuthClientMetadata, AuthClientMetadataDeviceType } from "@t3tools/contracts";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as Crypto from "node:crypto";

export const SESSION_COOKIE_NAME = "t3_session";

export function base64UrlEncode(input: string | Uint8Array): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buffer.toString("base64url");
}

export function base64UrlDecodeUtf8(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signPayload(payload: string, secret: Uint8Array): string {
  return Crypto.createHmac("sha256", Buffer.from(secret)).update(payload).digest("base64url");
}

export function timingSafeEqualBase64Url(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return Crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeNonEmptyString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIpAddress(value: string | null | undefined): string | undefined {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
}

function inferDeviceType(userAgent: string | undefined): AuthClientMetadataDeviceType {
  if (!userAgent) {
    return "unknown";
  }

  const normalized = userAgent.toLowerCase();
  if (/bot|crawler|spider|slurp|curl|wget/.test(normalized)) {
    return "bot";
  }
  if (/ipad|tablet/.test(normalized)) {
    return "tablet";
  }
  if (/iphone|android.+mobile|mobile/.test(normalized)) {
    return "mobile";
  }
  return "desktop";
}

function inferBrowser(userAgent: string | undefined): string | undefined {
  if (!userAgent) {
    return undefined;
  }
  const normalized = userAgent;
  if (/Edg\//.test(normalized)) return "Edge";
  if (/OPR\//.test(normalized)) return "Opera";
  if (/Electron\//.test(normalized)) return "Electron";
  if (/Firefox\//.test(normalized)) return "Firefox";
  if (/Chrome\//.test(normalized) || /CriOS\//.test(normalized)) return "Chrome";
  if (/Safari\//.test(normalized) && !/Chrome\//.test(normalized)) return "Safari";
  return undefined;
}

function inferOs(userAgent: string | undefined): string | undefined {
  if (!userAgent) {
    return undefined;
  }
  const normalized = userAgent;
  if (/iPhone|iPad|iPod/.test(normalized)) return "iOS";
  if (/Android/.test(normalized)) return "Android";
  if (/Mac OS X|Macintosh/.test(normalized)) return "macOS";
  if (/Windows NT/.test(normalized)) return "Windows";
  if (/Linux/.test(normalized)) return "Linux";
  return undefined;
}

function readRemoteAddressFromSource(source: unknown): string | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  const candidate = source as {
    readonly remoteAddress?: string | null;
    readonly socket?: {
      readonly remoteAddress?: string | null;
    };
  };

  return normalizeIpAddress(candidate.socket?.remoteAddress ?? candidate.remoteAddress);
}

export function deriveAuthClientMetadata(input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly label?: string;
}): AuthClientMetadata {
  const userAgent = normalizeNonEmptyString(input.request.headers["user-agent"]);
  const ipAddress = readRemoteAddressFromSource(input.request.source);
  const os = inferOs(userAgent);
  const browser = inferBrowser(userAgent);
  return {
    ...(input.label ? { label: input.label } : {}),
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
    deviceType: inferDeviceType(userAgent),
    ...(os ? { os } : {}),
    ...(browser ? { browser } : {}),
  };
}
