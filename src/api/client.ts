// Single API layer. oseFetch = client-side failover (layer 2): home → render.
// Layer 1 is the Cloudflare Worker "ose-failover" in front of VITE_API_HOME.
import { useServerStatus } from "../store/serverStatus";

const env = import.meta.env;
const BASES: string[] = [env.VITE_API_HOME, env.VITE_API_RENDER]
  .map((b: string | undefined) => (b || "").trim().replace(/\/$/, ""))
  .filter((b: string) => b.length > 0);
if (BASES.length === 0) BASES.push((env.VITE_API_LOCAL || "http://127.0.0.1:8000").replace(/\/$/, ""));

const FAILOVER_STATUS = new Set([502, 504, 520, 521, 522, 523, 524, 530]);
const TOKEN_KEY = "ctplanner.token";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  requestId?: string;
  constructor(status: number, code: string, message: string, details: unknown, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session-only login */
  }
}

let preferred = 0; // index of the base that answered last
// V1.4: send the hub cookie ose_pass (Domain=.ose.vn) to the API once the paywall is on (build with VITE_OSE_PASS=1;
// the backend then allows credentials). Off: no cookies, exactly as before.
const CREDENTIALS: RequestCredentials = env.VITE_OSE_PASS === "1" ? "include" : "same-origin";

async function oseFetch(path: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown = null;
  for (let k = 0; k < BASES.length; k++) {
    const i = (preferred + k) % BASES.length;
    try {
      const res = await fetch(BASES[i] + path, { credentials: CREDENTIALS, ...init });
      if (FAILOVER_STATUS.has(res.status) && k < BASES.length - 1) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      preferred = i;
      const served = res.headers.get("X-Served-By") || (i === 0 ? "home" : "render");
      useServerStatus.getState().setServedBy(served);
      return res;
    } catch (e) {
      lastErr = e; // network error → try the next base
    }
  }
  useServerStatus.getState().setServedBy("offline");
  throw new ApiError(0, "NETWORK", "Không kết nối được máy chủ", String(lastErr));
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export async function api<T>(method: string, path: string, body?: Body, headers: Record<string, string> = {}): Promise<T> {
  const h: Record<string, string> = { ...headers };
  const token = getToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await oseFetch(path, { method, headers: h, body: payload });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.blob();
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details: unknown }; request_id?: string }) || {};
    if (res.status === 401) setToken(null);
    if (err.error?.code === "READ_ONLY_BACKUP") useServerStatus.getState().setReadOnly(true);
    throw new ApiError(res.status, err.error?.code || "HTTP_ERROR", err.error?.message || `HTTP ${res.status}`,
      err.error?.details, err.request_id);
  }
  return data as T;
}

export async function apiWithHeaders<T>(method: string, path: string, body?: Body, headers: Record<string, string> = {}): Promise<{ data: T; etag: string | null }> {
  const h: Record<string, string> = { ...headers };
  const token = getToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) h["Content-Type"] = "application/json";
  const res = await oseFetch(path, { method, headers: h, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || "HTTP_ERROR", data?.error?.message || `HTTP ${res.status}`, data?.error?.details, data?.request_id);
  return { data: data as T, etag: res.headers.get("ETag") };
}

/** Download a binary endpoint and save it with the given file name. */
async function fetchBlob(path: string): Promise<Blob> {
  const h: Record<string, string> = {};
  const token = getToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  const res = await oseFetch(path, { method: "GET", headers: h });
  if (!res.ok) {
    let code = "HTTP_ERROR", message = `HTTP ${res.status}`;
    try { const j = await res.json(); code = j?.error?.code || code; message = j?.error?.message || message; } catch { /* not JSON */ }
    throw new ApiError(res.status, code, message, []);
  }
  return res.blob();
}

export async function download(path: string, filename: string): Promise<void> {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** URL for <img> of a stored file (auth header cannot be sent by <img>, so fetch as blob). */
export async function fileObjectUrl(fileId: string): Promise<string> {
  const blob = await fetchBlob(`/api/v1/files/${fileId}/content`);
  return URL.createObjectURL(blob);
}

export const apiBases = BASES;
