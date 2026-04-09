import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/lib/auth/auth-context"
import { Analytics } from "@vercel/analytics/next"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "PLNT - AI-Powered Nursery Management",
  description: "Optimize your plant nursery operations with drone surveys and AI plant counting",
  keywords: "plant nursery, drone survey, plant counting, AI, agriculture technology",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },

}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          {children}
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}