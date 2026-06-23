import React from "react"
import type { Metadata } from 'next'
import { Libre_Baskerville, Playfair_Display } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { AppProviders } from '@/components/app-providers'
import './globals.css'

// Declare the Geist and Geist_Mono variables before using them
const Geist = () => ({ subsets: ["latin"] });
const Geist_Mono = () => ({ subsets: ["latin"] });

const libreBaskerville = Libre_Baskerville({ 
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-sans"
});
const playfairDisplay = Playfair_Display({ 
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif"
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.legalshaman.com"),
  title: {
    default: "Legal Shaman | Navigate Your Legal Disputes",
    template: "%s | Legal Shaman",
  },
  description:
    "Legal Shaman helps you navigate UK legal disputes — search solicitors, legal aid, and free advice; get guided lawyer matches; and explore signposting resources. Not legal advice.",
  keywords: [
    "legal aid UK",
    "find a solicitor",
    "free legal advice",
    "legal directory",
    "housing lawyer",
    "employment lawyer",
  ],
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: "https://www.legalshaman.com",
    siteName: "Legal Shaman",
    title: "Legal Shaman | Navigate Your Legal Disputes",
    description:
      "Search the UK legal directory, get guided lawyer matches, and find free legal help — solicitors, legal aid, and signposting resources.",
    images: [{ url: "/logo.jpg", width: 512, height: 512, alt: "Legal Shaman" }],
  },
  twitter: {
    card: "summary",
    title: "Legal Shaman | Navigate Your Legal Disputes",
    description:
      "Search solicitors, legal aid, and free advice across the UK. The Shaman does not advise, only guides.",
    images: ["/logo.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      {
        url: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-32x32-dark.png",
        sizes: "32x32",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/favicon-16x16-dark.png",
        sizes: "16x16",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    shortcut: [
      { url: "/favicon-32x32.png", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-32x32-dark.png", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${libreBaskerville.variable} ${playfairDisplay.variable} font-sans antialiased`}>
        <AppProviders>
          {children}
        </AppProviders>
        <Analytics />
      </body>
    </html>
  )
}
