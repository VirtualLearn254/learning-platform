import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ToastShell } from "@/lib/use-toast";

import "./globals.css";

export const metadata: Metadata = {
  title: "Learning Platform",
  description: "Internal video-lesson production platform",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=Sora:wght@400;500;600&family=JetBrains+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body><ToastShell>{children}</ToastShell></body>
    </html>
  );
}
