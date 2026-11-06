// Cryptographically-strong password generator (uses crypto.getRandomValues, with
// rejection sampling so there is no modulo bias).
export interface GenOpts {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

const SETS = {
  lower: "abcdefghijkmnopqrstuvwxyz", // no l
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ", // no I, O
  digits: "23456789", // no 0, 1
  symbols: "!@#$%^&*()-_=+[]{};:,.?",
};

export const DEFAULT_GEN: GenOpts = { length: 20, lower: true, upper: true, digits: true, symbols: true };

function pick(pool: string): string {
  const max = Math.floor(256 / pool.length) * pool.length;
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < max) return pool[buf[0] % pool.length];
  }
}

export function generatePassword(opts: GenOpts): string {
  const pools: string[] = [];
  if (opts.lower) pools.push(SETS.lower);
  if (opts.upper) pools.push(SETS.upper);
  if (opts.digits) pools.push(SETS.digits);
  if (opts.symbols) pools.push(SETS.symbols);
  if (pools.length === 0) pools.push(SETS.lower);
  const all = pools.join("");
  const len = Math.max(opts.length, pools.length);
  const chars: string[] = [];
  // Guarantee at least one char from each selected class.
  for (const p of pools) chars.push(pick(p));
  for (let i = chars.length; i < len; i++) chars.push(pick(all));
  // Fisher-Yates shuffle so the guaranteed chars aren't always in front.
  for (let i = chars.length - 1; i > 0; i--) {
    const r = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[r]] = [chars[r], chars[i]];
  }
  return chars.join("");
}

// Rough strength estimate (entropy bits) for the meter.
export function entropyBits(pw: string): number {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 30;
  return Math.round(pw.length * Math.log2(pool || 1));
}
