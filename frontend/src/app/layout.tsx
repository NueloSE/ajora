import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";

export const metadata: Metadata = {
  title: "Ajora — Trustless Rotating Savings",
  description: "Save together, trustlessly. Rotating and target savings on Stellar.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
