import { getIdentity } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const id = await getIdentity();
  return (
    <div className="mx-auto mt-16 max-w-lg text-center">
      <div className="glass rounded-2xl p-10">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/40 bg-accent-soft text-2xl">
          🔒
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Access <span className="grad-text">pending</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          You&rsquo;re signed in{id?.name ? ` as ${id.name}` : ""}, but pricing and
          ordering haven&rsquo;t been enabled for your account yet. An Axus
          administrator will grant access shortly.
        </p>
        <a
          href="/outpost.goauthentik.io/sign_out"
          className="mt-7 inline-block rounded-lg border border-line bg-white/[0.02] px-4 py-2 text-sm font-medium text-ink transition-all hover:border-accent hover:text-accent"
        >
          Sign out
        </a>
      </div>
    </div>
  );
}
