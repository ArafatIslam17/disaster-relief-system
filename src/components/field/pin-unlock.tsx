"use client";

import { useState } from "react";
import { unlockWithPin } from "@/lib/field/vault";
import { useField } from "./field-provider";
import { PinPad } from "./field-ui";

/** Offline unlock (UC-02, State Diagram 02): 5 wrong PINs lock the device until online sign-in. */
export function PinUnlock() {
  const { t, setPhase, session } = useField();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(pin: string) {
    setBusy(true);
    const r = await unlockWithPin(pin);
    setBusy(false);
    if (r.ok) {
      setError(null);
      setPhase("ready");
    } else if (r.reason === "wrong") {
      setError(t("pinWrong", { n: r.remaining }));
    } else if (r.reason === "noSession") {
      setPhase("signedOut");
    } else {
      setPhase("reauth");
    }
  }

  return (
    <PinPad
      t={t}
      title={t("pinUnlockTitle")}
      hint={session ? t("signedInAs", { name: session.fullName }) : undefined}
      error={error}
      busy={busy}
      onComplete={submit}
    />
  );
}
