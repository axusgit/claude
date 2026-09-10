// app/admin/guide/page.tsx — admin manual. Behind the /admin SSO wall (nginx) and
// additionally gated on app-order membership.
import Link from "next/link";
import { getEntitledIdentity } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Guide — Axus Readiness Order",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent-soft font-display text-sm font-semibold text-accent">
        {n}
      </span>
      <div className="min-w-0 pt-0.5">
        <h3 className="font-display text-[15px] font-semibold text-ink">{title}</h3>
        <div className="mt-1 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  );
}

export default async function AdminGuidePage() {
  const identity = await getEntitledIdentity();
  if (!identity) {
    return (
      <div className="glass mx-auto max-w-lg rounded-xl p-8 text-center">
        <h1 className="font-display text-lg font-semibold">Sign-in required</h1>
        <p className="mt-2 text-sm text-muted">
          The admin guide is restricted to Axus administrators.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Back to catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <Link href="/admin" className="text-sm text-muted transition-colors hover:text-ink">
        ← Back to dashboard
      </Link>

      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">
        Admin <span className="grad-text">Guide</span>
      </h1>
      <p className="mt-2 text-sm text-muted">
        Managing the catalog and keeping items priced. (Signed in as {identity.email}.)
      </p>

      <section className="glass mt-8 rounded-2xl p-6 sm:p-8">
        <ol className="space-y-5">
          <Step n={1} title="Usage & Audit dashboard">
            <Link href="/admin" className="text-cyan hover:underline">
              /admin
            </Link>{" "}
            shows quotes created (customer, organization, total, IP) and site visits, with
            totals for the last 7 days.
          </Step>
          <Step n={2} title="Catalog Status">
            <Link href="/admin/catalog" className="text-cyan hover:underline">
              /admin/catalog
            </Link>{" "}
            lists every item with its <span className="text-ink">live status</span> and
            approximate price from the distributor feed. Status meanings:{" "}
            <span className="text-ink">Active</span> = priced;{" "}
            <span className="text-warn">Not found</span> = the part number isn&rsquo;t in
            the distributor catalog; <span className="text-warn">Not authorized</span> = the
            vendor isn&rsquo;t authorized on our account (e.g. HP printers).
          </Step>
          <Step n={3} title="Make a Not-found item price">
            Paste a working identifier into the{" "}
            <span className="text-ink">TD SYNNEX SKU / Mfg Part #</span> field and Save
            (turns green). Use either a numeric TD SYNNEX SKU (from the TD SYNNEX EC portal)
            or a manufacturer part number — the <span className="text-ink">Mfg. Part #</span>{" "}
            on CDW.com (not the CDW Part #). Numbers are looked up as a SKU, anything else as
            a part number.
          </Step>
          <Step n={4} title="Set a Suggested Alternative">
            In <span className="text-ink">Set Replacement</span>, enter a successor or
            comparable part number (+ an optional friendly label) and Save. Customers will
            then see it as an accept-able alternative on the catalog whenever the original
            can&rsquo;t be priced.
          </Step>
          <Step n={5} title="When the same model has another config">
            If the distributor stocks the <em>same</em> model under a different config, put
            that part number in the item&rsquo;s own SKU field (so it prices directly) —
            don&rsquo;t set it as a replacement, or the item appears to replace itself.
          </Step>
          <Step n={6} title="Finding part numbers that work">
            For discontinued items, CDW.com often shows a &ldquo;we found a
            replacement&rdquo; box — its Mfg. Part # usually works in TD SYNNEX. For
            configured PCs, search the model name to find current configs, then paste a Mfg.
            Part # that resolves. The definitive source is the TD SYNNEX EC portal.
          </Step>
        </ol>
      </section>
    </div>
  );
}
