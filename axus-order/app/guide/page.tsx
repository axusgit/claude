// app/guide/page.tsx — user manual for regular users + Axus administrators.
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "User Guide — Axus Readiness Order",
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

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <Link href="/" className="text-sm text-muted transition-colors hover:text-ink">
        ← Back to catalog
      </Link>

      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">
        How to use <span className="grad-text">Readiness Order</span>
      </h1>
      <p className="mt-2 text-sm text-muted">
        A quick guide to building an EPIC-readiness hardware quote — and, for Axus staff,
        keeping the catalog priced.
      </p>

      {/* ---------------- Regular users ---------------- */}
      <section className="glass mt-8 rounded-2xl p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <span className="rounded-md bg-cyan/15 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-cyan">
            For everyone
          </span>
          <h2 className="font-display text-xl font-semibold">Building a quote</h2>
        </div>

        <ol className="space-y-5">
          <Step n={1} title="Browse the catalog">
            Hardware is grouped by category (Desktops, Laptops, Barcode Readers, Signature
            Pads, Printers, Document Scanners, Label Printers, Webcams, Servers,
            Networking). Use the category chips near the top to filter, or leave{" "}
            <span className="text-ink">All</span> selected.
          </Step>
          <Step n={2} title="Note the required peripherals">
            The orange <span className="font-medium text-accent">Required</span> banner
            flags items that are mandatory for Epic go-live —{" "}
            <span className="text-ink">signature pads</span> (patient signatures) and{" "}
            <span className="text-ink">document scanners</span> (scanning documents into
            Epic). You can skip them only if your site already owns compatible equipment.
          </Step>
          <Step n={3} title="Understand the prices">
            Every price is an <span className="text-ink">approximate, non-binding
            budgetary estimate</span> (shown with a ~). Some items show{" "}
            <span className="font-medium text-warn">Not available</span> — those can&rsquo;t
            be priced from our live distributor feed right now.
          </Step>
          <Step n={4} title="Use a Suggested Alternative">
            When an item is <span className="text-warn">Not available</span>, the{" "}
            <span className="text-ink">Suggested Alternative</span> column offers a
            comparable product that <em>can</em> be priced. Tick its checkbox (e.g.
            &ldquo;Use FortiAP 231K&rdquo;) to put that alternative on your quote — its
            price fills in immediately and the quote clearly notes it replaced the
            original.
          </Step>
          <Step n={5} title="Add items and set quantities">
            Click <span className="text-ink">Add</span>, then use the −/+ buttons or type a
            number to set the quantity. Added rows are highlighted.
          </Step>
          <Step n={6} title="Review your cart">
            The <span className="text-ink">cart icon</span> (top-right) shows how many items
            you have. Click it to open the cart, adjust quantities, or remove items. Your
            cart is kept as you keep shopping.
          </Step>
          <Step n={7} title="Get your quote">
            Click <span className="text-ink">Get Quote →</span>. The first time, you&rsquo;ll
            review the disclaimer and enter your <span className="text-ink">name, email,
            and organization</span>. After that, quotes generate in one click.
          </Step>
          <Step n={8} title="Work with the quote">
            Each quote has a unique number and is valid for <span className="text-ink">30
            days</span>. From the quote you can{" "}
            <span className="text-ink">Download / Print a PDF</span> (on the Axus
            letterhead), <span className="text-ink">email it to Axus</span>, remove line
            items with the ✕ button, or continue shopping. It&rsquo;s saved — bookmark the
            page to return to it.
          </Step>
        </ol>

        <p className="mt-6 rounded-lg border border-line bg-white/[0.02] px-4 py-3 text-xs text-muted">
          Prices, availability, and part numbers are indicative and may change. This is a
          budgetary estimate, not a formal quotation — final pricing is confirmed by Axus.
        </p>
      </section>
    </div>
  );
}
