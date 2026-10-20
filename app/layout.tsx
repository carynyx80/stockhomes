import type { Metadata, Viewport } from "next";
import { BRAND } from "@/config/stoxhomes";
import { ENTRY_BOOT_SCRIPT } from "@/lib/entry";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.tagline,
};

export const viewport: Viewport = {
  themeColor: "#7A0F17",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The boot script may add data-entered before hydration.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ENTRY_BOOT_SCRIPT }} />
        <noscript>
          <style>{"[data-intro]{display:none!important}"}</style>
        </noscript>
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
