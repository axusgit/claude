import Link from "next/link";

export function TopNav({
  userName,
  isAdmin = false,
  restricted = false,
}: {
  userName: string | null;
  isAdmin?: boolean;
  restricted?: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-[#f2591f] text-sm font-bold text-black shadow-[0_0_18px_-2px_rgba(255,122,61,0.7)] transition-transform group-hover:scale-105">
            A
            <span className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/30" />
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight">
            <span className="grad-text">Axus</span>{" "}
            <span className="text-muted font-medium">Readiness</span>
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          {!restricted && (
            <Link
              href="/"
              className="text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              Catalog
            </Link>
          )}
          {!restricted && isAdmin && (
            <Link
              href="/admin/catalog"
              className="text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              Catalog Status
            </Link>
          )}
          {userName && (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-sm text-muted">
                <span className="hidden sm:inline">{userName}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-accent/40 bg-accent-soft text-xs font-semibold text-accent">
                  {userName.slice(0, 1).toUpperCase()}
                </span>
              </span>
              <a
                href="/outpost.goauthentik.io/sign_out"
                className="text-sm font-medium text-muted transition-colors hover:text-ink"
              >
                Sign out
              </a>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
