import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, FileUp, Plus, Trash2 } from "lucide-react";
import {
  api,
  companiesApi,
  contactsApi,
  quotesApi,
  type Company,
  type Contact,
  type QuoteItem,
} from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";

const money = (n: number) =>
  "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () =>
  new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const plusDaysStr = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
};
const emptyItem = (): QuoteItem => ({ qty: 1, item: "", description: "", unit_price: 0, discount: 0 });

export function QuoteBuilder() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creatingUpload, setCreatingUpload] = useState(false);

  const [quoteDate, setQuoteDate] = useState(todayStr());
  const [validUntil, setValidUntil] = useState(plusDaysStr(30));
  const [company, setCompany] = useState(params.get("company") ?? "");
  const [contact, setContact] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [salesperson, setSalesperson] = useState("JMK");
  const [job, setJob] = useState("");
  const [shipping, setShipping] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Net30");
  const [dueDate, setDueDate] = useState(plusDaysStr(30));
  const [tax, setTax] = useState("EXEMPT");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([emptyItem()]);
  // Edit an existing DRAFT quote in place (regenerate, no new envelope).
  const edit = params.get("edit");
  const [quoteNumber, setQuoteNumber] = useState("");

  useEffect(() => {
    companiesApi.list().then(setCompanies).catch(() => {});
    contactsApi.list().then(setContacts).catch(() => {});
  }, []);

  // Prefill address + first contact once data loads (company came from create step).
  useEffect(() => {
    if (!company) return;
    const co = companies.find((c) => c.name === company);
    if (co) {
      setAddress((prev) => prev || (co.address ?? ""));
      setPhone((prev) => prev || (co.phone ?? ""));
    }
    const persons = contacts.filter((c) => (c.company ?? "") === company);
    setContact((prev) => prev || (persons[0]?.name ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, contacts]);

  // Duplicate an existing quote: carry over the line items (item # / description /
  // unit price) but reset quantities, discounts, and all client info so you start
  // fresh for a new customer. Works from any quote, even a completed one.
  const from = params.get("from");
  useEffect(() => {
    if (!from) return;
    api
      .getEnvelope(from)
      .then((d) => {
        const q = d.envelope.quote_data;
        if (!q) return;
        setItems(
          q.items && q.items.length
            ? q.items.map((it) => ({
                qty: 1,
                item: it.item,
                description: it.description,
                unit_price: it.unit_price,
                discount: 0,
              }))
            : [emptyItem()],
        );
        if (q.salesperson) setSalesperson(q.salesperson);
        if (q.shipping_method) setShipping(q.shipping_method);
        if (q.payment_terms) setPaymentTerms(q.payment_terms);
        if (q.tax) setTax(q.tax);
        // Start fresh — client + per-deal fields cleared.
        setCompany("");
        setContact("");
        setAddress("");
        setPhone("");
        setJob("");
        setDeliveryDate("");
        setDueDate("");
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  // Edit mode: load the FULL quote back into the builder (keeps quote number,
  // client, and all per-deal fields) so a save regenerates the SAME quote.
  useEffect(() => {
    if (!edit) return;
    api
      .getEnvelope(edit)
      .then((d) => {
        const q = d.envelope.quote_data;
        if (!q) return;
        setQuoteNumber(q.quote_number ?? "");
        if (q.quote_date) setQuoteDate(q.quote_date);
        if (q.valid_until) setValidUntil(q.valid_until);
        setCompany(q.customer?.company ?? "");
        setContact(q.customer?.contact ?? "");
        setAddress(q.customer?.address ?? "");
        setPhone(q.customer?.phone ?? "");
        if (q.salesperson) setSalesperson(q.salesperson);
        if (q.job) setJob(q.job);
        if (q.shipping_method) setShipping(q.shipping_method);
        if (q.delivery_date) setDeliveryDate(q.delivery_date);
        if (q.payment_terms) setPaymentTerms(q.payment_terms);
        if (q.due_date) setDueDate(q.due_date);
        if (q.tax) setTax(q.tax);
        setNotes(q.notes ?? "");
        setItems(q.items && q.items.length ? q.items.map((it) => ({ ...it })) : [emptyItem()]);
      })
      .catch(() => setError("Could not load this quote for editing."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit]);

  function selectCompany(name: string) {
    setCompany(name);
    const co = companies.find((c) => c.name === name);
    setAddress(co?.address ?? "");
    setPhone(co?.phone ?? "");
    const persons = contacts.filter((c) => (c.company ?? "") === name);
    setContact(persons[0]?.name ?? "");
  }

  const companyContacts = contacts.filter((c) => (c.company ?? "") === company);

  function setItem(i: number, patch: Partial<QuoteItem>) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  // Discount is per-unit (comes off the unit price), so it scales with quantity.
  const lineTotal = (it: QuoteItem) =>
    (Number(it.qty) || 0) * ((Number(it.unit_price) || 0) - (Number(it.discount) || 0));
  const subtotal = items.reduce((s, it) => s + lineTotal(it), 0);
  const totalDiscount = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.discount) || 0), 0);
  const taxExempt = !tax || /exempt/i.test(tax);
  const total = subtotal + (taxExempt ? 0 : Number(tax) || 0);

  async function generate() {
    if (!company.trim()) {
      setError("Select or enter a customer company.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const quote = {
        quote_number: edit ? quoteNumber : "",
        quote_date: quoteDate,
        valid_until: validUntil || undefined,
        customer: {
          company: company.trim(),
          contact: contact.trim() || undefined,
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
        },
        salesperson,
        job,
        shipping_method: shipping,
        delivery_date: deliveryDate,
        payment_terms: paymentTerms,
        due_date: dueDate,
        items: items.filter((it) => it.item.trim() || it.description.trim()),
        tax,
        notes: notes.trim() || undefined,
      };
      const env = edit
        ? await quotesApi.update(edit, `${company.trim()} Quote`, quote)
        : await quotesApi.create(`${company.trim()} Quote`, quote);
      nav(`/envelopes/${env.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${edit ? "save" : "generate"} the quote`);
    } finally {
      setGenerating(false);
    }
  }

  // "Upload a ready quote" — a salesperson already has the quote populated.
  // Create the Quote envelope and hand off to the editor to upload the file.
  async function createForUpload() {
    if (!company.trim()) {
      setError("Select a company first, then upload the quote file.");
      return;
    }
    setCreatingUpload(true);
    setError(null);
    try {
      const env = await api.createEnvelope({
        title: `${company.trim()} Quote`,
        doc_type: "Quote",
        company: company.trim(),
      });
      nav(`/envelopes/${env.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the upload");
      setCreatingUpload(false);
    }
  }

  const field = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand";
  const lbl = "text-xs font-medium text-muted";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav("/")} className="text-muted hover:text-ink">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold">{edit ? "Edit Quote" : "New Quote"}</h1>
        {!edit && (
          <div className="ml-auto flex items-center gap-2">
            <a
              href={quotesApi.templateUrl()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-muted hover:text-ink"
              title="Download a blank Axus quote template to fill in"
            >
              <Download className="h-4 w-4" /> Quote template
            </a>
            <Button variant="outline" onClick={() => void createForUpload()} disabled={creatingUpload}>
              <FileUp className="h-4 w-4" /> {creatingUpload ? "Opening…" : "Upload a ready quote"}
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        Build the quote below, or — if a salesperson already prepared one — pick the company and click
        <span className="font-medium"> Upload a ready quote</span> to attach their finished .pdf / .doc.
      </p>
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Quote</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={lbl}>Date</label>
              <Input value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className={lbl}>Pricing valid until</label>
              <Input value={validUntil} onChange={(e) => setValidUntil(e.target.value)} placeholder="e.g. July 20, 2026" />
            </div>
          </div>
          <p className="text-xs text-muted">
            Quote # is assigned automatically on the date (e.g. 08202026.001).
          </p>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Quote to</div>
          <div className="space-y-1">
            <label className={lbl}>Company</label>
            <select value={company} onChange={(e) => selectCompany(e.target.value)} className={field}>
              <option value="">Select a company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={lbl}>Contact</label>
            {companyContacts.length > 0 ? (
              <select value={contact} onChange={(e) => setContact(e.target.value)} className={field}>
                {companyContacts.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="pt-1 text-xs text-muted">
                {company
                  ? "No contacts for this company yet — add one on the Contacts tab."
                  : "Select a company to choose a contact."}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className={lbl}>Phone</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
          </div>
          <div className="space-y-1">
            <label className={lbl}>Address</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className={field}
              placeholder="Street, City, ST ZIP"
            />
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Details</div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["Salesperson", salesperson, setSalesperson],
              ["Job", job, setJob],
              ["Shipping", shipping, setShipping],
              ["Delivery date", deliveryDate, setDeliveryDate],
              ["Payment terms", paymentTerms, setPaymentTerms],
              ["Due date", dueDate, setDueDate],
            ] as [string, string, (v: string) => void][]
          ).map(([l, v, set]) => (
            <div key={l} className="space-y-1">
              <label className={lbl}>{l}</label>
              <Input value={v} onChange={(e) => set(e.target.value)} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Line items</div>
          <Button variant="outline" onClick={() => setItems((a) => [...a, emptyItem()])}>
            <Plus className="h-4 w-4" /> Add line
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-2 py-2 font-medium">Qty</th>
                <th className="px-2 py-2 font-medium">Item #</th>
                <th className="px-2 py-2 font-medium">Description</th>
                <th className="px-2 py-2 font-medium">Unit Price</th>
                <th className="px-2 py-2 font-medium">Disc./unit</th>
                <th className="px-2 py-2 text-right font-medium">Line Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      min="0"
                      value={it.qty}
                      onChange={(e) => setItem(i, { qty: Number(e.target.value) })}
                      className={`${field} w-16`}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <Input value={it.item} onChange={(e) => setItem(i, { item: e.target.value })} className="w-36" />
                  </td>
                  <td className="px-1 py-1">
                    <Input value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={it.unit_price}
                      onChange={(e) => setItem(i, { unit_price: Number(e.target.value) })}
                      className={`${field} w-24`}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={it.discount}
                      onChange={(e) => setItem(i, { discount: Number(e.target.value) })}
                      className={`${field} w-24`}
                    />
                  </td>
                  <td className="px-2 py-1 text-right font-medium">{money(lineTotal(it))}</td>
                  <td className="px-1 py-1">
                    <button
                      onClick={() => setItems((a) => a.filter((_, idx) => idx !== i))}
                      className="text-muted hover:text-red-600"
                      title="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="font-medium">{money(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Total discount</span>
              <span>{money(totalDiscount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Sales tax</span>
              <Input value={tax} onChange={(e) => setTax(e.target.value)} className="w-28 text-right" />
            </div>
            <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</label>
          <span className="text-xs text-muted">{notes.length}/500</span>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          maxLength={500}
          rows={3}
          className={field}
          placeholder="Optional notes shown on the quote, above “Thank you for your business.” (max 500 characters)"
        />
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => nav("/")}>
          Cancel
        </Button>
        <Button onClick={() => void generate()} disabled={generating || !company.trim()}>
          {generating ? "Saving…" : edit ? "Save changes" : "Generate quote"}
        </Button>
      </div>
    </div>
  );
}
