"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

/** GET a URL and expose { data, error, loading, reload }. Pass null to skip. Stale responses are ignored. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(url);
      if (id === seq.current) setData(d);
    } catch (err) {
      if (id === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }
    void load();
  }, [url, load]);

  return { data, error, loading, reload: load };
}
