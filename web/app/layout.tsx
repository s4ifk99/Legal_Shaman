import React from "react"
import type { Metadata } from 'next'
import { Libre_Baskerville, Playfair_Display } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { AppProviders } from '@/components/app-providers'
import { AhrefsAnalytics } from '@/components/analytics/ahrefs-analytics'
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
    default: "Legal Shaman | UK Legal Directory",
    template: "%s | Legal Shaman",
  },
  description:
    "UK legal directory for legal information, financing options, matched providers, reviews and costs — plus a calm plan of action for your dispute. Not legal advice.",
  keywords: [
    "UK legal directory",
    "legal aid UK",
    "find a solicitor",
    "free legal advice",
    "legal financing",
    "housing lawyer",
    "employment lawyer",
  ],
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: "https://www.legalshaman.com",
    siteName: "Legal Shaman",
    title: "Legal Shaman | UK Legal Directory",
    description:
      "Find legal information, financing, matched providers, reviews and costs across the UK — then get a clear plan for your situation.",
    images: [{ url: "/logo.jpg", width: 512, height: 512, alt: "Legal Shaman" }],
  },
  twitter: {
    card: "summary",
    title: "Legal Shaman | UK Legal Directory",
    description:
      "UK legal directory: information, financing, providers, reviews and costs. Not a solicitor — we guide, we do not advise.",
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
      <head>
        <AhrefsAnalytics />
      </head>
      <body className={`${libreBaskerville.variable} ${playfairDisplay.variable} font-sans antialiased`}>
        <AppProviders>
          {children}
        </AppProviders>
        <Analytics />
      </body>
    </html>
  )
}
