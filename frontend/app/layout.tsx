import type { Metadata, Viewport } from "next";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./globals.css";

import { NO_FLASH_THEME } from "@/lib/theme";
import { API_BASE } from "@/lib/config";
import { buildEarlyDashboardFetch } from "@/lib/early-fetch";

// Origins the app talks to right after boot. Opening the connections (DNS + TCP
// + TLS, ~3 round-trips from the Philippines) while the browser is still
// downloading the JS means the first API / auth request finds a warm socket
// instead of paying that handshake on the critical path.
const originOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
};
const PRECONNECT_ORIGINS = Array.from(
  new Set([originOf(API_BASE), originOf(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://njzvuwkepaasnsvuujgx.supabase.co")].filter(Boolean)),
);

export const metadata: Metadata = {
  title: "AcadTrack — Teacher",
  description: "AcadTrack Teacher management portal",
  manifest: "/manifest.json",
  icons: { icon: "/logo.jpg", apple: "/logo.jpg" },
};

export const viewport: Viewport = {
  themeColor: "#3b82f6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
        <script dangerouslySetInnerHTML={{ __html: buildEarlyDashboardFetch(API_BASE) }} />
        {PRECONNECT_ORIGINS.map((origin) => (
          <link key={`pc-${origin}`} rel="preconnect" href={origin} crossOrigin="anonymous" />
        ))}
        {PRECONNECT_ORIGINS.map((origin) => (
          <link key={`dns-${origin}`} rel="dns-prefetch" href={origin} />
        ))}
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
