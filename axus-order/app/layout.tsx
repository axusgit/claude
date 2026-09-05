import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { getIdentity, roleOf, canSeePricing } from "@/lib/auth";
import { TopNav } from "./components/TopNav";
import { ThemeToggle } from "./components/ThemeToggle";

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
      suppressHydrationWarning
      className={`${inter.variable} ${display.variable} ${mono.variable}`}
    >
      <body>
        {/* Set the theme before paint to avoid a flash */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('ro-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();",
          }}
        />
        {/* Theme toggle — fixed top-right */}
        <div className="fixed right-4 top-4 z-50">
          <ThemeToggle />
        </div>
        <div className="relative z-10 flex min-h-screen">
          <TopNav
            userName={identity?.name ?? null}
            isAdmin={isAdmin}
            restricted={restricted}
          />
          <div className="min-w-0 flex-1">
            <main className="mx-auto max-w-6xl px-5 py-9">{children}</main>
          <footer className="mx-auto max-w-6xl px-5 pb-10 pt-6 text-xs text-faint">
            <div className="hairline mb-4" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <span>Axus Technologies</span>
              <span aria-hidden>·</span>
              <span>in collaboration with</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hcn-logo.svg"
                alt="Health Choice Network"
                className="hcn-logo h-3.5 w-auto opacity-80"
              />
              <span className="w-full sm:ml-auto sm:w-auto">
                Ballpark pricing is indicative and non-binding.
              </span>
            </div>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
