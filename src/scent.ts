// SCENT v0.1 for foxprefs: the resolver that foxscope loads in Node, and
// the answer the extension gives to foxscope over onMessageExternal.
// The types are a structural copy of foxscope's; foxprefs does not depend on it.
import { FoxprefsError } from "./errors.js";
import { derived, type Prefs } from "./prefs.js";
import type { Sensitivity } from "./schema.js";

export interface ScentField {
  name: string;
  label: string;
  sensitivity: Sensitivity;
  derivable?: boolean;
}
export interface ScentResolver {
  namespace: string;
  list(): Promise<ScentField[]>;
  read(fields: string[], opts: { derive: boolean }): Promise<Record<string, unknown>>;
}
export interface ScentRequest {
  agent: string;
  fields: string[];
  purpose: string;
  ttlSeconds?: number;
}
export type ScentResponse =
  | { status: "granted"; grantId: string; expiresAt: string; values: Record<string, unknown> }
  | { status: "pending"; requestId: string }
  | { status: "denied"; reason: string };

export const NAMESPACE = "prefs";
/** The only extension that gets an answer over onMessageExternal. */
export const FOXSCOPE_ID = "foxscope@pooriaarab";
export const MAX_READ_FIELDS = 100;

/**
 * The SCENT resolver for the "prefs" namespace. foxscope owns consent: it
 * calls read only for fields the user granted. This resolver still never
 * returns a private field, and it leaves out unknown and unset names.
 */
export function prefsResolver(prefs: Prefs): ScentResolver {
  const prefix = `${NAMESPACE}.`;
  return Object.freeze({
    namespace: NAMESPACE,
    async list() {
      return (await prefs.all()).map((f) => ({ name: prefix + f.name, label: f.label, sensitivity: f.sensitivity, derivable: f.derivable }));
    },
    async read(fields: string[], opts: { derive: boolean }) {
      const wanted = new Set(fields.filter((n) => typeof n === "string" && n.startsWith(prefix)).map((n) => n.slice(prefix.length)));
      const out: Record<string, unknown> = {};
      for (const f of await prefs.all()) {
        if (!wanted.has(f.name) || f.sensitivity === "private" || !("value" in f)) continue;
        const field = prefs.schema.find((x) => x.name === f.name)!;
        out[prefix + f.name] = opts.derive === true ? derived(field, f.value) : f.value;
      }
      return out;
    },
  });
}

/** The parts of a WebExtension MessageSender that the check reads. */
export interface SenderLike {
  id?: string;
}

/**
 * The answer to one onMessageExternal message. Undefined means "no answer":
 * the listener returns nothing, so the sender sees what it would see if
 * foxprefs were not installed. Only foxscope gets data.
 *   {type: "scent.list"}                 -> ScentField[]
 *   {type: "scent.read", fields, derive} -> { "prefs.x": value }
 *   a bad scent.read                     -> { error }
 */
export function answerScent(resolver: ScentResolver, sender: SenderLike, message: unknown): Promise<unknown> | undefined {
  // Synchronous on purpose: a listener that returns a promise answers the
  // sender, even when the promise gives undefined.
  if (sender?.id !== FOXSCOPE_ID) return undefined;
  const m = message as { type?: unknown; fields?: unknown; derive?: unknown } | null;
  if (typeof m !== "object" || m === null) return undefined;
  if (m.type === "scent.list") return resolver.list();
  if (m.type !== "scent.read") return undefined;
  return readFor(resolver, m);
}

async function readFor(resolver: ScentResolver, m: { fields?: unknown; derive?: unknown }): Promise<unknown> {
  try {
    if (!Array.isArray(m.fields) || m.fields.length > MAX_READ_FIELDS || !m.fields.every((f) => typeof f === "string")) {
      throw new FoxprefsError("bad-request", `fields must be a list of at most ${MAX_READ_FIELDS} field names.`);
    }
    if (m.derive !== undefined && typeof m.derive !== "boolean") throw new FoxprefsError("bad-request", "derive must be true or false.");
    return await resolver.read(m.fields, { derive: m.derive === true });
  } catch (error) {
    return { error: error instanceof FoxprefsError ? `${error.code}: ${error.message}` : "foxprefs could not read the preferences." };
  }
}
