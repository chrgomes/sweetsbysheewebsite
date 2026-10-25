import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { BRAND_ASSETS, BRAND_NAME } from "@/lib/brand";
import { env } from "@/lib/env";
import "./globals.css";

const fraunces = localFont({
  src: [
    { path: "../fonts/fraunces-latin-wght-normal.woff2", style: "normal" },
    { path: "../fonts/fraunces-latin-wght-italic.woff2", style: "italic" },
  ],
  weight: "100 900",
  variable: "--font-fraunces",
  display: "swap",
});

const inter = localFont({
  src: "../fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(env().NEXT_PUBLIC_SITE_URL),
  title: { default: BRAND_NAME, template: `%s | ${BRAND_NAME}` },
  openGraph: { siteName: BRAND_NAME, images: [{ url: BRAND_ASSETS.ogImage, width: 1200, height: 630, alt: `${BRAND_NAME} logo` }] },
  // Indexing is only allowed in production; staging and previews stay out of search engines.
  robots: env().APP_ENV === "production" ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#fcefe9",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
