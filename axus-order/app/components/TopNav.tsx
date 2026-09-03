import Link from "next/link";

export function TopNav({
  userName,
  isAdmin = false,
}: {
  userName: string | null;
  isAdmin?: boolean;
}) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-sm font-bold text-white">
            A
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            Axus <span className="text-muted font-medium">Order</span>
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link
            href="/"
            className="text-sm font-medium text-muted hover:text-ink transition-colors"
          >
            Catalog
          </Link>
          {isAdmin && (
            <Link
              href="/admin/catalog"
              className="text-sm font-medium text-muted hover:text-ink transition-colors"
            >
              Catalog Status
            </Link>
          )}
          {userName && (
            <span className="flex items-center gap-2 text-sm text-muted">
              <span className="hidden sm:inline">{userName}</span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {userName.slice(0, 1).toUpperCase()}
              </span>
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}
