import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { getIdentity, roleOf, canSeePricing } from "@/lib/auth";
import { TopNav } from "./components/TopNav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-space" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-code" });

export const metadata: Metadata = {
  title: "Axus Readiness Order",
  description: "IT hardware ordering & budgetary quotes — Axus Technologies",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getIdentity();
  const isAdmin = identity ? roleOf(identity) === "admin" : false;
  const restricted = identity ? !canSeePricing(identity) : false;
  return (
    <html
      lang="en"
      className={`${inter.variable} ${display.variable} ${mono.variable}`}
    >
      <body>
        <div className="relative z-10">
          <TopNav
            userName={identity?.name ?? null}
            isAdmin={isAdmin}
            restricted={restricted}
          />
          <main className="mx-auto max-w-6xl px-5 py-9">{children}</main>
          <footer className="mx-auto max-w-6xl px-5 pb-10 pt-6 text-xs text-faint">
            <div className="hairline mb-4" />
            Axus Technologies · Ballpark pricing is indicative and non-binding.
          </footer>
        </div>
      </body>
    </html>
  );
}
