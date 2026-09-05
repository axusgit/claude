import Link from "next/link";

// Vertical left sidebar navigation.
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
    <aside className="sticky top-0 z-30 flex h-screen w-48 shrink-0 flex-col border-r border-line/80 bg-canvas/70 px-3 py-5 backdrop-blur-xl">
      <nav className="flex flex-col gap-1">
        {!restricted && (
          <Link
            href="/"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-line/50 hover:text-ink"
          >
            Catalog
          </Link>
        )}
        {!restricted && isAdmin && (
          <Link
            href="/admin/catalog"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-line/50 hover:text-ink"
          >
            Catalog Status
          </Link>
        )}
      </nav>

      {userName && (
        <div className="mt-auto flex flex-col gap-2 border-t border-line/70 pt-4">
          <span className="flex items-center gap-2 px-2 text-sm text-muted">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent-soft text-xs font-semibold text-accent">
              {userName.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{userName}</span>
          </span>
          <a
            href="/outpost.goauthentik.io/sign_out"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-line/50 hover:text-ink"
          >
            Sign out
          </a>
        </div>
      )}
    </aside>
  );
}
