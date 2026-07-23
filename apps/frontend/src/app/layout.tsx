import type { Metadata } from "next";
import { Manrope, Space_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell/AppShell";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-manrope",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "Game Token Wallet",
  description: "Tokenize offline group games as on-chain SPL tokens.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${manrope.variable} ${spaceMono.variable}`}>
      <body className="min-h-screen font-sans text-text-primary">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
