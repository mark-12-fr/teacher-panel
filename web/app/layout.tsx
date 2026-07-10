import type { Metadata, Viewport } from "next";
import Script from "next/script";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./globals.css";

import { NO_FLASH_THEME } from "@/lib/theme";

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
      <body>
        {/* Apply the saved theme before paint to avoid a flash of the wrong mode. */}
        <Script id="theme-noflash" strategy="beforeInteractive">
          {NO_FLASH_THEME}
        </Script>
        {children}
      </body>
    </html>
  );
}
