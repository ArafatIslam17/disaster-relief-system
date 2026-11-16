/** Browser-side API client for the dashboard and auth pages. Errors carry the server's envelope. */
export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ClientApiError(0, "NETWORK", "Network error. Check the connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!res.ok) {
    const details = data?.error?.details;
    // Name the offending field so validation errors are diagnosable ("password: Invalid input: …").
    const fieldMessages = Array.isArray(details)
      ? details
          .filter((d: { message?: string }) => d.message)
          .map((d: { path?: string; message?: string }) => (d.path ? `${d.path}: ${d.message}` : d.message))
          .join(" ")
      : "";
    throw new ClientApiError(res.status, data?.error?.code ?? `HTTP_${res.status}`, fieldMessages || data?.error?.message || res.statusText, details);
  }
  return data as T;
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
