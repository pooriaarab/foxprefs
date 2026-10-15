// Check a value against its field, read a value from text (CLI and forms),
// and write a value as text (prompts and forms). Every check throws
// `bad-value` with the field name; nothing picks a default.
import { FoxprefsError } from "./errors.js";
import { currencyDigits, type Money, type PrefField } from "./schema.js";

export const MAX_TEXT = 120;
export const MAX_ITEM = 100;
export const MAX_ITEMS = 50;
// Control characters (\p{Cc}), the line and paragraph separators, every
// format character (\p{Cf}: bidi marks and controls, zero-width characters,
// the soft hyphen, the word joiner) and the whole tag block U+E0000-E007F.
// A newline could start a new instruction line in an agent prompt, and an
// invisible character makes a value read differently than it is. Tag
// characters are invisible, yet a model reads them as ASCII text.
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029\u{e0000}-\u{e007f}]/u;

const bad = (field: PrefField, why: string): never => {
  throw new FoxprefsError("bad-value", `${field.name}: ${why}.`);
};

function text(field: PrefField, value: unknown, max: number, what: string): string {
  if (typeof value !== "string") bad(field, `${what} must be text, not ${describe(value)}`);
  const s = (value as string).trim();
  if (!s) bad(field, `${what} is empty`);
  if (s.length > max) bad(field, `${what} has more than ${max} characters`);
  if (CONTROL.test(s)) bad(field, `${what} must be one line with no control or invisible characters`);
  return s;
}

const describe = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "a list" : typeof v);

function money(field: PrefField, value: unknown): Money {
  const m = value as Partial<Money> | null;
  if (typeof m !== "object" || m === null || Array.isArray(m) || Object.keys(m).some((k) => k !== "value" && k !== "currency")) {
    bad(field, 'money must be { value, currency }, for example { value: 20000, currency: "USD" }');
  }
  const { value: amount, currency } = m as Money;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) bad(field, "the currency must be a 3-letter ISO 4217 code in capitals, like USD");
  if (!Intl.supportedValuesOf("currency").includes(currency)) bad(field, `${currency} is not a known currency`);
  if (!Number.isSafeInteger(amount) || amount < 0) bad(field, "the amount must be a whole number of minor units (cents), 0 or more");
  return { value: amount, currency };
}

/** Check a value for a field and return the clean copy that foxprefs stores. */
export function validateValue(field: PrefField, value: unknown): unknown {
  let clean: unknown;
  switch (field.type) {
    case "enum":
      if (typeof value !== "string" || !field.options?.includes(value)) bad(field, `must be one of ${field.options?.join(", ")}`);
      clean = value;
      break;
    case "string":
      clean = text(field, value, MAX_TEXT, "the value");
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) bad(field, `must be a number, not ${describe(value)}`);
      if (field.min !== undefined && (value as number) < field.min) bad(field, `must be ${field.min} or more`);
      if (field.max !== undefined && (value as number) > field.max) bad(field, `must be ${field.max} or less`);
      clean = value;
      break;
    case "boolean":
      if (typeof value !== "boolean") bad(field, `must be true or false, not ${describe(value)}`);
      clean = value;
      break;
    case "list": {
      if (!Array.isArray(value)) bad(field, `must be a list of text, not ${describe(value)}`);
      const items = [...new Set((value as unknown[]).map((v) => text(field, v, MAX_ITEM, "each item")))];
      if (items.length === 0) bad(field, "the list is empty; unset the field instead");
      if (items.length > MAX_ITEMS) bad(field, `the list has more than ${MAX_ITEMS} items`);
      clean = items;
      break;
    }
    case "money":
      clean = money(field, value);
      break;
  }
  const why = field.check?.(clean as never);
  if (why) bad(field, `${JSON.stringify(field.type === "list" ? (clean as string[]).join(", ") : clean)} ${why}`);
  return clean;
}

const TRUE = ["true", "yes", "on"];
const FALSE = ["false", "no", "off"];

/** Read a value from the text a person typed. Throws `bad-value` when the text is not clear. */
export function parseValue(field: PrefField, input: string): unknown {
  const s = input.trim();
  switch (field.type) {
    case "number":
      if (!/^-?\d+(\.\d+)?$/.test(s)) bad(field, `"${s}" is not a number`);
      return validateValue(field, Number(s));
    case "boolean":
      if (TRUE.includes(s.toLowerCase())) return true;
      if (FALSE.includes(s.toLowerCase())) return false;
      return bad(field, `"${s}" is not yes or no`);
    case "list":
      return validateValue(field, s.split(",").map((x) => x.trim()).filter(Boolean));
    case "money": {
      const m = /^(\d+)(?:\.(\d+))?\s*([A-Za-z]{3})$/.exec(s);
      if (!m) return bad(field, `"${s}" is not an amount with a currency, like 200 USD`);
      const [, whole, frac = "", code] = m as unknown as [string, string, string | undefined, string];
      const currency = code.toUpperCase();
      validateValue(field, { value: 0, currency });
      const digits = currencyDigits(currency);
      if (frac.length > digits) bad(field, `${currency} has ${digits} decimal places, so "${s}" is not an exact amount`);
      return validateValue(field, { value: Number(whole + frac.padEnd(digits, "0")), currency });
    }
    default:
      return validateValue(field, s);
  }
}

/** Money as text with its decimal places, like `200.00 USD`. */
export function formatMoney(m: Money): string {
  const digits = currencyDigits(m.currency);
  const s = String(m.value).padStart(digits + 1, "0");
  return `${digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s} ${m.currency}`;
}

/** A stored value as text, the form that parseValue reads back. */
export function formatValue(field: PrefField, value: unknown): string {
  switch (field.type) {
    case "list":
      return (value as string[]).join(", ");
    case "boolean":
      return value ? "yes" : "no";
    case "money":
      return formatMoney(value as Money);
    default:
      return String(value);
  }
}
