import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { getIdentity, roleOf } from "@/lib/auth";
import { TopNav } from "./components/TopNav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Axus Order",
  description: "IT hardware ordering & ballpark quotes — Axus Technologies",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getIdentity();
  const isAdmin = identity ? roleOf(identity) === "admin" : false;
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <TopNav userName={identity?.name ?? null} isAdmin={isAdmin} />
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 pb-10 pt-4 text-xs text-faint">
          Axus Technologies · Ballpark pricing is indicative and non-binding.
        </footer>
      </body>
    </html>
  );
}
