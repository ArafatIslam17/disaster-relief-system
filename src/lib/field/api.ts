/** Network access for the field app. Every call honours the Offline Mode Simulator. */

let simulatedOffline = false;

export function setSimulatedOffline(value: boolean) {
  simulatedOffline = value;
}

export function networkAvailable(): boolean {
  return !simulatedOffline && (typeof navigator === "undefined" || navigator.onLine);
}

export class OfflineError extends Error {
  constructor() {
    super("No network connection");
  }
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function fieldFetch<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  if (!networkAvailable()) throw new OfflineError();
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  } catch {
    throw new OfflineError();
  }
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!res.ok) {
    throw new ApiFailure(res.status, data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? res.statusText, data?.error?.details);
  }
  return data as T;
}
