import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./mobile.css"; // Mobile: phone / Safari layout (safe areas, HUD placement next to the touch controls)

export const metadata: Metadata = {
  title: "Nightfall — A city in characters",
  description: "Walk the rain-soaked streets of a sprawling cyberpunk city, rendered live in ASCII with textmode.js.",
  // Mobile: Add to Home Screen runs full screen (standalone) with the status bar over the dark city.
  // The manifest, icon and apple-touch-icon come from app/manifest.ts, app/icon.tsx and app/apple-icon.tsx.
  applicationName: "Nightfall",
  appleWebApp: { capable: true, title: "Nightfall", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false },
  other: { "apple-mobile-web-app-capable": "yes" }, // older iOS still reads the apple- prefixed tag
};
// Mobile: viewport-fit=cover draws under the notch / Dynamic Island / home indicator (the UI pads itself
// with env(safe-area-inset-*)); maximum-scale=1 stops iOS zooming into a focused input (chat).
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover", themeColor: "#071015", colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
