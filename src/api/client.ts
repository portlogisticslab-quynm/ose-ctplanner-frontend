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
let preferredAt = 0; // V1.4.1: when we moved off the home base; retry home after RETRY_HOME_MS
const RETRY_HOME_MS = 60_000;
// V1.4: send the hub cookie ose_pass (Domain=.ose.vn) to the API once the paywall is on (build with VITE_OSE_PASS=1;
// the backend then allows credentials). Off: no cookies, exactly as before.
const CREDENTIALS: RequestCredentials = env.VITE_OSE_PASS === "1" ? "include" : "same-origin";

// V1.4.1: a preview ("tính tạm") lives in the memory of the server that computed it. When that was Render, keep
// talking to Render directly for it – through the Worker the request would go back home once home is up again.
const PREVIEW_ON_RENDER = new Set<string>();
const PREVIEW_PATH = /^\/api\/v1\/previews\/([^/?]+)/;

export function notePreviewServer(r: unknown): void {
  const p = r as { id?: string; preview?: boolean; server?: string } | null;
  if (p && p.preview && p.id && p.server === "render" && BASES.length > 1) PREVIEW_ON_RENDER.add(p.id);
}

// V1.4.2: one failed or slow request (e.g. a long equipment replay that Cloudflare cuts at 100 s, whose error page has
// no CORS header and so looks like a network error) must not switch the whole app to the read-only backup. Before
// failing over, ask the main server's /api/health: if it answers "ok" and writable, keep using it and report the
// error of this one request instead. The answer is cached for a few seconds.
const HEALTH_TIMEOUT_MS = 15_000;   // the path VN → Cloudflare → tunnel sometimes takes several seconds: no short timeout
const HEALTH_CACHE_MS = 15_000;
let healthAt = 0;
let healthOk = false;

export async function primaryHealthy(force = false): Promise<boolean> {
  if (BASES.length < 2) return true;
  if (!force && Date.now() - healthAt < HEALTH_CACHE_MS) return healthOk;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const r = await fetch(`${BASES[0]}/api/health?t=${Date.now()}`, { cache: "no-store", signal: ctl.signal });
    const j = r.ok ? await r.json() : null;
    healthOk = !!j && j.status === "ok" && j.read_only === false && (r.headers.get("X-Served-By") || "home") !== "render";
  } catch {
    healthOk = false;
  } finally {
    clearTimeout(timer);
  }
  healthAt = Date.now();
  return healthOk;
}

/** V1.4.2: while the app shows backup mode, check the main server every 30 s and switch back as soon as it is healthy
 *  (no reload needed). */
const RECOVERY_PROBE_MS = 30_000;
if (typeof window !== "undefined" && BASES.length > 1) {
  window.setInterval(() => {
    const st = useServerStatus.getState();
    if (st.servedBy !== "render" && !st.readOnly) return;
    void primaryHealthy(true).then((ok) => {
      if (!ok) return;
      preferred = 0;
      useServerStatus.getState().setServedBy("home");
    });
  }, RECOVERY_PROBE_MS);
}

// V1.4.2: long requests go STRAIGHT to the main server (the VPS, VITE_API_DIRECT), not through the Worker: the Worker
// "ose-failover" gives the main server only a few seconds before it answers from the read-only backup, so a slow
// equipment replay, report, Excel/DXF import, status change (runs the validation), clone, capacity run… came back from the backup (NOT_FOUND for runs made today, read-only
// banner, "Mô phỏng tạm"). If the direct call cannot reach the VPS, the normal path (Worker → backup) is used.
const DIRECT = ((env.VITE_API_DIRECT as string | undefined) || "").trim().replace(/\/$/, "");
const LONG_PATH = /\/(replay|report|reports|imports|demo-data|file-runs|compare|status|validate|clone|export(\.dxf|\.geojson)?)(\/|\?|$)|\/cad\/dxf\/|\/projects\/import$|\/runs\/(capacity|yard-plan)$/;

export function isLongPath(path: string): boolean {
  return LONG_PATH.test(path.split("?")[0]);
}

async function oseFetch(path: string, init: RequestInit): Promise<Response> {
  const pin = path.match(PREVIEW_PATH);
  if (pin && PREVIEW_ON_RENDER.has(pin[1])) {
    try {
      return await fetch(BASES[BASES.length - 1] + path, { credentials: CREDENTIALS, ...init });
    } catch (e) {
      throw new ApiError(0, "NETWORK", "Không kết nối được máy chủ dự phòng", String(e));
    }
  }
  if (DIRECT && isLongPath(path)) {
    try {
      const res = await fetch(DIRECT + path, { credentials: CREDENTIALS, ...init });
      if (!FAILOVER_STATUS.has(res.status)) {
        useServerStatus.getState().setServedBy("home");
        return res;
      }
    } catch (e) {
      // GET: VPS not reachable directly → fall through to the Worker / backup. A write may already have reached the
      // VPS, so it is not sent a second time (the backup is read-only anyway).
      const method = (init.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        throw new ApiError(0, "NETWORK", "Không kết nối được máy chủ chính cho thao tác này – kiểm tra kết quả rồi thử lại", String(e));
      }
    }
  }
  let lastErr: unknown = null;
  // V1.4.1: after a failover, go back to the home base (Worker) once a minute instead of staying on Render
  // until the page is reloaded (the Worker itself picks home or Render)
  if (preferred !== 0 && Date.now() - preferredAt > RETRY_HOME_MS) preferred = 0;
  for (let k = 0; k < BASES.length; k++) {
    const i = (preferred + k) % BASES.length;
    try {
      const res = await fetch(BASES[i] + path, { credentials: CREDENTIALS, ...init });
      if (FAILOVER_STATUS.has(res.status) && k < BASES.length - 1) {
        if (i === 0 && (await primaryHealthy(true))) {
          useServerStatus.getState().setServedBy("home");
          return res;   // main server is up: report this request's error, do not switch to the backup
        }
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (i !== preferred && i !== 0) preferredAt = Date.now();
      preferred = i;
      const served = res.headers.get("X-Served-By") || (i === 0 ? "home" : "render");
      useServerStatus.getState().setServedBy(served);
      return res;
    } catch (e) {
      if (i === 0 && k < BASES.length - 1 && (await primaryHealthy(true))) {
        useServerStatus.getState().setServedBy("home");
        throw new ApiError(0, "PRIMARY_REQUEST_FAILED",
          "Máy chủ chính đang chạy nhưng không trả lời yêu cầu này (quá thời gian hoặc mạng chập chờn) – thử lại; với hoạt ảnh, chọn cửa sổ ngắn hơn",
          String(e));
      }
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
  notePreviewServer(data);
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
