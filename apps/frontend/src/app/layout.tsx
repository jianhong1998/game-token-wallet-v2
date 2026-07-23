import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Game Token Wallet",
  description: "Tokenize offline group games as on-chain SPL tokens.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="app-shell min-h-screen px-4">{children}</body>
    </html>
  );
}
