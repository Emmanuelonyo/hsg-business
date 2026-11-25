"use client";
/**
 * Shared API client. Same-origin /api (proxied to Nest by next.config.ts rewrites).
 * Token is kept in localStorage and sent as a bearer header. Errors arrive as {"error":{"code","message"}}.
 */
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

const TOKEN_KEY = "hsg_token";
const ROLE_KEY = "hsg_role";
export const session = {
  get token() { return typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY); },
  get role() { return typeof window === "undefined" ? null : (localStorage.getItem(ROLE_KEY) as "SME" | "OPERATOR" | null); },
  set(token: string, role: string) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(ROLE_KEY, role); },
  clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(ROLE_KEY); },
};

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  if (session.token) headers.set("Authorization", `Bearer ${session.token}`);
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  const res = await fetch(`/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, cache: "no-store" });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth")) {
      session.clear();
      window.location.href = "/login";
    }
    throw new ApiError(body?.error?.code ?? "UNKNOWN", body?.error?.message ?? res.statusText, res.status);
  }
  return body as T;
}
