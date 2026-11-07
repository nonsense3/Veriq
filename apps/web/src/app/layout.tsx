import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { CyberCursor } from "@/components/cyber-cursor";
import { RouteTransition } from "@/components/route-transition";
import { SmoothScroll } from "@/components/smooth-scroll";
import { ToastProvider } from "@/components/toast";
import { AuthProvider } from "@/lib/auth";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veriq | Verify before you trust",
  icons: { icon: "/icon.svg" },
  description: "Investigate suspicious links, domains and messages. Evidence-backed risk reports with verifiable on-chain integrity.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef0f6" },
    { media: "(prefers-color-scheme: dark)", color: "#07080c" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
        <SmoothScroll />
        <RouteTransition />
        <CyberCursor />
      </body>
    </html>
  );
}
