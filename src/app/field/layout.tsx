import type { Metadata, Viewport } from "next";
import { getLocale } from "@/lib/i18n/server";
import { FieldProvider } from "@/components/field/field-provider";
import { ServiceWorkerRegistrar } from "@/components/field/sw-registrar";

export const metadata: Metadata = {
  title: "Relief Field App",
  description: "Offline-first household registration and relief distribution for field volunteers.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Relief Field", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#0F766E",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <FieldProvider initialLocale={locale}>
      <ServiceWorkerRegistrar />
      {children}
    </FieldProvider>
  );
}
