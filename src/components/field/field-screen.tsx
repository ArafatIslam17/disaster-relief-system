"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useField } from "./field-provider";
import { BottomNav, SyncAlerts, TopBar } from "./chrome";
import { LoginScreen } from "./login-screen";
import { PinUnlock } from "./pin-unlock";
import { RegisterScreen } from "./register-screen";
import { DistributeScreen } from "./distribute-screen";
import { RecordsScreen } from "./records-screen";
import { SyncScreen } from "./sync-screen";

const SCREENS: Record<string, () => React.JSX.Element> = {
  "/field/register": RegisterScreen,
  "/field/distribute": DistributeScreen,
  "/field/records": RecordsScreen,
  "/field/sync": SyncScreen,
};

/**
 * Every /field route renders this component. Screens switch on the pathname via history.pushState,
 * so moving between them never needs the server and the in-memory vault key survives.
 */
export default function FieldScreen() {
  const { phase, pathname, locale, reauthOpen } = useField();

  useEffect(() => {
    if (phase === "ready" && !SCREENS[pathname]) window.history.replaceState(null, "", "/field/register");
  }, [phase, pathname]);

  const Screen = SCREENS[pathname] ?? RegisterScreen;
  const ready = phase === "ready";

  return (
    <div className={cn("min-h-dvh bg-canvas text-ink", locale === "bn" && "font-bangla")}>
      <TopBar showSync={ready} />
      <main className={cn("mx-auto max-w-[480px] px-3 pt-4", ready ? "pb-[92px]" : "pb-8")}>
        {phase === "loading" && <p className="py-10 text-center text-sm text-ink-muted">…</p>}
        {phase === "signedOut" && <LoginScreen mode="new" />}
        {phase === "reauth" && <LoginScreen mode="reauth" />}
        {phase === "locked" && <PinUnlock />}
        {ready &&
          (reauthOpen ? (
            <LoginScreen mode="refresh" />
          ) : (
            <div className="space-y-4">
              <SyncAlerts />
              <Screen />
            </div>
          ))}
      </main>
      {ready && !reauthOpen && <BottomNav />}
    </div>
  );
}
