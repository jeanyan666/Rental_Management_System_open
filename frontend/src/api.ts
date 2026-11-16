export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function extractDetail(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg).replace(/^Value error,\s*/, "");
        }
        return "";
      })
      .filter(Boolean)
      .join("；");
  }
  return "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const detail = extractDetail(payload) || `请求失败（${response.status}）`;
    if (response.status === 401 && !path.startsWith("/api/auth/login") && path !== "/api/auth/me") {
      window.dispatchEvent(new Event("qiyu:unauthorized"));
    }
    throw new ApiError(response.status, detail);
  }
  return payload as T;
}

export function uploadIdCard(file: File): Promise<import("./types").OcrResult> {
  const body = new FormData();
  body.append("file", file);
  return api("/api/ocr/id-card", { method: "POST", body });
}
