import React from "react"
import type { Metadata } from 'next'
import { Libre_Baskerville, Playfair_Display } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
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
  title: 'Legal Shaman | The Most Powerful Agentic Search Engine for All Your Disputes',
  description:
    'Legal Shaman is the most powerful agentic search engine for all your disputes. Tell us your problem and we\'ll point you in the right direction — solicitors, legal aid, free advice, and more.',
  generator: 'v0.app',
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    shortcut: '/favicon-32x32.png',
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${libreBaskerville.variable} ${playfairDisplay.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
