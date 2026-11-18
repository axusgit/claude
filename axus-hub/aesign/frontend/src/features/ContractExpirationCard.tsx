import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { api, type Envelope } from "@/lib/api";
import { Card } from "@/components/ui";

// Contract Expiration Reminder: Not Applicable, or an expiration date plus a
// reminder 1–8 weeks before it. When the reminder date arrives the Axus team
// inbox (info@) is emailed once. Editable at any status (contracts expire long
// after signing); each change saves immediately and re-arms the reminder.
const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8];

function ymd(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : "";
}
function fmt(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function minusWeeks(d: string, w: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(y, m - 1, day - w * 7);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function ContractExpirationCard({
  envelope,
  onSaved,
}: {
  envelope: Envelope;
  onSaved: (msg: string | null, err?: string, updated?: Envelope) => void;
}) {
  const [applicable, setApplicable] = useState(false);
  const [date, setDate] = useState("");
  const [weeks, setWeeks] = useState(1);
  const sentAt = envelope.contract_reminder_sent_at;

  useEffect(() => {
    const d = ymd(envelope.contract_expires_on);
    setApplicable(!!d);
    setDate(d);
    setWeeks(envelope.contract_reminder_weeks ?? 1);
  }, [envelope.id, envelope.contract_expires_on, envelope.contract_reminder_weeks]);

  async function save(patch: { contract_expires_on: string | null; contract_reminder_weeks: number | null }) {
    try {
      const updated = await api.updateEnvelope(envelope.id, patch);
      onSaved(
        patch.contract_expires_on
          ? `Contract expiration reminder set: info@ is emailed on ${fmt(
              minusWeeks(patch.contract_expires_on, patch.contract_reminder_weeks ?? 1),
            )}.`
          : "Contract expiration reminder set to Not Applicable.",
        undefined,
        updated,
      );
    } catch (e) {
      onSaved(null, e instanceof Error ? e.message : "Could not save the expiration reminder");
    }
  }

  const today = ymd(new Date().toLocaleDateString("en-CA"));
  const remindOn = date ? minusWeeks(date, weeks) : "";

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <CalendarClock className="h-3.5 w-3.5" /> Contract Expiration Reminder
      </div>
      <select
        value={applicable ? "set" : "na"}
        onChange={(e) => {
          const on = e.target.value === "set";
          setApplicable(on);
          if (!on) {
            setDate("");
            void save({ contract_expires_on: null, contract_reminder_weeks: null });
          }
        }}
        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
      >
        <option value="na">Not Applicable</option>
        <option value="set">Set expiration date</option>
      </select>
      {applicable && (
        <div className="mt-2 space-y-2">
          <label className="block text-xs text-muted">
            Date of the Expiration
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                  void save({ contract_expires_on: e.target.value, contract_reminder_weeks: weeks });
                }
              }}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand"
            />
          </label>
          <label className="block text-xs text-muted">
            Reminder
            <select
              value={weeks}
              onChange={(e) => {
                const w = Number(e.target.value);
                setWeeks(w);
                if (date) void save({ contract_expires_on: date, contract_reminder_weeks: w });
              }}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand"
            >
              {WEEKS.map((w) => (
                <option key={w} value={w}>
                  {w} week{w === 1 ? "" : "s"} before expiration
                </option>
              ))}
            </select>
          </label>
          {date && (
            <p className="text-[11px] text-muted">
              {sentAt && ymd(envelope.contract_expires_on) === date && envelope.contract_reminder_weeks === weeks
                ? `Reminder emailed to info@ on ${new Date(sentAt).toLocaleDateString()}.`
                : date < today
                  ? "This contract has already expired; no reminder will be sent."
                  : remindOn <= today
                    ? "The reminder date has passed; info@ is emailed within 15 minutes (from 8 AM ET)."
                    : `info@ will be emailed on ${fmt(remindOn)} (8 AM ET).`}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
