"use client";

import { useEffect } from "react";

/** Registers the offline service worker (production builds only; dev uses HMR). */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async (reg) => {
        await navigator.serviceWorker.ready;
        if (navigator.onLine) (reg.active ?? reg.waiting ?? reg.installing)?.postMessage({ type: "REFRESH_SHELL" });
      })
      .catch((err) => console.error("[field] service worker registration failed", err));
  }, []);
  return null;
}
