// The preference fields: what each one holds, who may read it, and how to
// make a smaller answer from it. DEFAULT_SCHEMA is the set that ships.
import { FoxprefsError } from "./errors.js";

/** SCENT v0.1: who may read a field. "private" never leaves the browser. */
export type Sensitivity = "public" | "ask" | "private";
export const SENSITIVITIES: readonly Sensitivity[] = ["public", "ask", "private"];

export type FieldType = "enum" | "string" | "number" | "list" | "boolean" | "money";

/** Money in whole minor units (cents for USD) and an ISO 4217 code, as in foxgate. */
export interface Money {
  value: number;
  currency: string;
}

export interface PrefField {
  /** `<group>.<path>`, for example `shopping.size.top`. */
  name: string;
  label: string;
  type: FieldType;
  sensitivity: Sensitivity;
  /** The choices of an enum field. */
  options?: readonly string[];
  /** Number fields: the smallest and the largest value. */
  min?: number;
  max?: number;
  /** A text hint for forms, for example `200 USD`. */
  hint?: string;
  /** An extra check for a valid value. Return an error text, or nothing. */
  check?: (value: never) => string | undefined;
  /** The smaller answer that `derive: true` gives instead of the value. */
  derive?: (value: never) => unknown;
}

export type Schema = readonly PrefField[];

const NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** Check a schema and return it frozen. Throws `bad-schema`. */
export function defineSchema(fields: readonly PrefField[]): Schema {
  const seen = new Set<string>();
  for (const f of fields) {
    const fail = (why: string) => {
      throw new FoxprefsError("bad-schema", `Field ${JSON.stringify(f.name)}: ${why}.`);
    };
    if (typeof f.name !== "string" || !NAME.test(f.name)) fail("the name must be dotted lowercase words, like shopping.size.top");
    if (seen.has(f.name)) fail("the name is used twice");
    seen.add(f.name);
    if (!f.label) fail("it needs a label");
    if (!SENSITIVITIES.includes(f.sensitivity)) fail("the sensitivity must be public, ask or private");
    if (f.type === "enum" && !(f.options && f.options.length > 0)) fail("an enum needs options");
    if (!["enum", "string", "number", "list", "boolean", "money"].includes(f.type)) fail(`the type ${String(f.type)} is unknown`);
  }
  return Object.freeze(fields.map((f) => Object.freeze({ ...f })));
}

/** The group of a field: the part of the name before the first dot. */
export const groupOf = (name: string) => name.slice(0, name.indexOf("."));

/** The money amount in major units, for the bands. */
const major = (m: Money) => m.value / 10 ** currencyDigits(m.currency);

/** The number of minor-unit digits of a currency: 2 for USD, 0 for JPY. */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** A rough band. It does not know prices in each country, so it uses the major unit as is. */
const band = (low: number, high: number) => (m: Money) => (major(m) < low ? "low" : major(m) < high ? "mid" : "high");

function languageCheck(value: string) {
  try {
    Intl.getCanonicalLocales(value);
    return undefined;
  } catch {
    return "is not a BCP 47 language tag, for example en-CA";
  }
}

function timeZoneCheck(value: string) {
  try {
    void new Intl.DateTimeFormat("en", { timeZone: value });
    return undefined;
  } catch {
    return "is not an IANA time zone, for example America/Vancouver";
  }
}

const SITE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const sitesCheck = (sites: string[]) => sites.find((s) => !SITE.test(s)) && "must be site names like example.com, with no https:// and no path";

const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"];

export const DEFAULT_SCHEMA: Schema = defineSchema([
  { name: "identity.name", label: "Display name", type: "string", sensitivity: "ask" },
  { name: "identity.pronouns", label: "Pronouns", type: "string", sensitivity: "public", hint: "she/her" },
  { name: "identity.language", label: "Language", type: "string", sensitivity: "public", hint: "en-CA", check: languageCheck as never },
  { name: "identity.timeZone", label: "Time zone", type: "string", sensitivity: "public", hint: "America/Vancouver", check: timeZoneCheck as never },
  { name: "shopping.size.top", label: "Top size", type: "enum", options: SIZES, sensitivity: "public" },
  { name: "shopping.size.bottom", label: "Bottom size", type: "string", sensitivity: "public", hint: "32x30" },
  { name: "shopping.size.shoe", label: "Shoe size", type: "string", sensitivity: "public", hint: "US 10" },
  { name: "shopping.brands.avoid", label: "Brands to avoid", type: "list", sensitivity: "public" },
  { name: "shopping.materials.avoid", label: "Materials to avoid", type: "list", sensitivity: "public", hint: "wool, polyester" },
  { name: "food.diet", label: "Diet", type: "enum", options: ["none", "vegetarian", "vegan", "pescatarian", "halal", "kosher", "gluten-free", "keto"], sensitivity: "public" },
  { name: "food.allergies", label: "Allergies", type: "list", sensitivity: "ask", hint: "peanuts, shellfish" },
  { name: "food.dislikes", label: "Dislikes", type: "list", sensitivity: "public" },
  { name: "travel.seat", label: "Seat", type: "enum", options: ["window", "aisle", "any"], sensitivity: "public" },
  { name: "travel.airlines.prefer", label: "Preferred airlines", type: "list", sensitivity: "public" },
  { name: "travel.redeye", label: "Red-eye flights are fine", type: "boolean", sensitivity: "public" },
  { name: "travel.loyalty", label: "Loyalty numbers", type: "list", sensitivity: "private", hint: "Aeroplan 123456789" },
  { name: "budget.perPurchase", label: "Usual budget per purchase", type: "money", sensitivity: "ask", hint: "80 USD", derive: band(50, 250) as never },
  { name: "budget.monthly", label: "Monthly budget", type: "money", sensitivity: "ask", hint: "600 USD", derive: band(500, 2000) as never },
  { name: "communication.tone", label: "Tone", type: "enum", options: ["casual", "neutral", "formal"], sensitivity: "public" },
  { name: "communication.length", label: "Answer length", type: "enum", options: ["short", "medium", "long"], sensitivity: "public" },
  { name: "communication.format", label: "Format", type: "enum", options: ["plain", "bullets", "markdown"], sensitivity: "public" },
  { name: "accessibility.textSize", label: "Text size", type: "enum", options: ["default", "large", "larger"], sensitivity: "public" },
  { name: "accessibility.reducedMotion", label: "Reduce motion", type: "boolean", sensitivity: "public" },
  { name: "accessibility.captions", label: "Captions on", type: "boolean", sensitivity: "public" },
  { name: "rules.maxPurchase", label: "Never buy over", type: "money", sensitivity: "public", hint: "200 USD" },
  { name: "rules.neverShare", label: "Never share", type: "list", sensitivity: "public", hint: "phone number, home address" },
  { name: "rules.sites.block", label: "Never act on these sites", type: "list", sensitivity: "public", hint: "example.com", check: sitesCheck as never },
  { name: "rules.sites.ask", label: "Ask me before acting on", type: "list", sensitivity: "public", hint: "bank.example", check: sitesCheck as never },
]);

/** The groups of the default schema, in display order. */
export const GROUPS = ["identity", "shopping", "food", "travel", "budget", "communication", "accessibility", "rules"] as const;
