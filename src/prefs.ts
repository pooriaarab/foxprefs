// The prefs object: read, write, export and import the user's preferences.
// This is the owner's API, so get() returns private fields too. The agent
// surfaces (prompt, SCENT, MCP) filter by sensitivity.
import { FoxprefsError } from "./errors.js";
import { DEFAULT_SCHEMA, SENSITIVITIES, groupOf, type FieldType, type PrefField, type Schema, type Sensitivity } from "./schema.js";
import type { PrefStore, PrefsState } from "./store.js";
import { formatValue, parseValue, validateValue } from "./values.js";

export const FORMAT = "foxprefs/v1";
export const MAX_IMPORT_BYTES = 256 * 1024;

/** One field as a form or a list shows it. */
export interface FieldInfo {
  name: string;
  label: string;
  group: string;
  type: FieldType;
  options?: readonly string[];
  hint?: string;
  derivable: boolean;
  /** The sensitivity in effect: the user's choice, else the schema default. */
  sensitivity: Sensitivity;
  /** The value, when the field has one. */
  value?: unknown;
  /** The value as text, the form that setText reads. */
  text?: string;
}

export interface PrefsOptions {
  store: PrefStore;
  schema?: Schema;
  /** The clock for updatedAt. Default: Date.now. */
  now?: () => number;
}

export interface Prefs {
  readonly schema: Schema;
  /** Values of the named fields that have one. With derive, derivable fields give their smaller answer. */
  get(fields: string[], options?: { derive?: boolean }): Promise<Record<string, unknown>>;
  /** Check and store a value. Throws bad-value or unknown-field, and the store does not change. */
  set(field: string, value: unknown): Promise<void>;
  /** Read a value from typed text (`200 USD`, `yes`, `a, b`), then set it. */
  setText(field: string, text: string): Promise<void>;
  unset(field: string): Promise<void>;
  setSensitivity(field: string, sensitivity: Sensitivity): Promise<void>;
  /** Every field of the schema, with its value and its sensitivity. */
  all(): Promise<FieldInfo[]>;
  /** The whole record in the versioned `foxprefs/v1` format. */
  export(): Promise<PrefsState>;
  /** Replace every value with the ones in a `foxprefs/v1` record. All or nothing. */
  import(data: string | unknown): Promise<void>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Check a stored or imported record, field by field. */
export function checkState(schema: Schema, raw: unknown, code: "bad-store" | "bad-import"): PrefsState {
  const fail = (why: string): never => {
    throw new FoxprefsError(code, `${code === "bad-store" ? "The stored preferences are" : "The import is"} not valid: ${why}.`);
  };
  if (!isRecord(raw)) return fail("it is not a JSON object");
  if (raw.format !== FORMAT) return fail(`the format must be "${FORMAT}", not ${JSON.stringify(raw.format)}`);
  if (!isRecord(raw.values) || !isRecord(raw.sensitivity)) return fail("values and sensitivity must be objects");
  const byName = new Map(schema.map((f) => [f.name, f]));
  const values: Record<string, unknown> = {};
  const sensitivity: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw.values)) {
    const field = byName.get(name) ?? fail(`${JSON.stringify(name)} is not a field`);
    try {
      values[name] = validateValue(field, value);
    } catch (error) {
      fail(error instanceof Error ? error.message.replace(/\.$/, "") : String(error));
    }
  }
  for (const [name, s] of Object.entries(raw.sensitivity)) {
    if (!byName.has(name)) fail(`${JSON.stringify(name)} is not a field`);
    if (!SENSITIVITIES.includes(s as Sensitivity)) fail(`${name}: the sensitivity ${JSON.stringify(s)} is not public, ask or private`);
    sensitivity[name] = s as string;
  }
  return { format: FORMAT, values, sensitivity, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString() };
}

/** A copy of JSON data, so callers cannot change what is stored. */
const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function derived(field: PrefField, value: unknown): unknown {
  if (!field.derive) return value;
  let out: unknown;
  try {
    out = field.derive(value as never);
    if (out === undefined || JSON.stringify(out) === undefined) throw new Error("it returned no JSON value");
  } catch (error) {
    throw new FoxprefsError("bad-value", `${field.name}: derive failed: ${error instanceof Error ? error.message : String(error)}.`);
  }
  return copy(out);
}

export function createPrefs(options: PrefsOptions): Prefs {
  const schema = options.schema ?? DEFAULT_SCHEMA;
  const store = options.store;
  const now = options.now ?? Date.now;
  const byName = new Map(schema.map((f) => [f.name, f]));
  const fieldOf = (name: string): PrefField => {
    const f = typeof name === "string" ? byName.get(name) : undefined;
    if (!f) throw new FoxprefsError("unknown-field", `${JSON.stringify(name)} is not a preference field.`);
    return f;
  };

  // One call at a time, so two writes in one process never lose each other.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  const load = async (): Promise<PrefsState> => {
    const raw = await store.read();
    return raw === undefined ? { format: FORMAT, values: {}, sensitivity: {}, updatedAt: new Date(0).toISOString() } : checkState(schema, raw, "bad-store");
  };
  const change = (fn: (state: PrefsState) => boolean) =>
    serial(async () => {
      const state = await load();
      if (fn(state)) await store.write({ ...state, updatedAt: new Date(now()).toISOString() });
    });

  const prefs: Prefs = {
    schema,
    get: (fields, o = {}) =>
      serial(async () => {
        const list = fields.map(fieldOf);
        const { values } = await load();
        const out: Record<string, unknown> = {};
        for (const f of list) if (f.name in values) out[f.name] = o.derive ? derived(f, values[f.name]) : copy(values[f.name]);
        return out;
      }),
    set: async (field, value) => {
      const f = fieldOf(field);
      const clean = validateValue(f, value);
      return change((s) => ((s.values[f.name] = clean), true));
    },
    setText: async (field, text) => prefs.set(field, parseValue(fieldOf(field), text)),
    unset: async (field) => {
      const f = fieldOf(field);
      return change((s) => f.name in s.values && delete s.values[f.name]);
    },
    setSensitivity: async (field, sensitivity) => {
      const f = fieldOf(field);
      if (!SENSITIVITIES.includes(sensitivity)) throw new FoxprefsError("bad-value", `${f.name}: the sensitivity ${JSON.stringify(sensitivity)} is not public, ask or private.`);
      return change((s) => {
        if (sensitivity === f.sensitivity) delete s.sensitivity[f.name];
        else s.sensitivity[f.name] = sensitivity;
        return true;
      });
    },
    all: () =>
      serial(async () => {
        const { values, sensitivity } = await load();
        return schema.map((f) => {
          const info: FieldInfo = { name: f.name, label: f.label, group: groupOf(f.name), type: f.type, derivable: Boolean(f.derive), sensitivity: (sensitivity[f.name] as Sensitivity) ?? f.sensitivity };
          if (f.options) info.options = [...f.options];
          if (f.hint) info.hint = f.hint;
          if (f.name in values) Object.assign(info, { value: copy(values[f.name]), text: formatValue(f, values[f.name]) });
          return info;
        });
      }),
    export: () => serial(async () => copy(await load())),
    import: async (data) => {
      let raw = data;
      if (typeof data === "string") {
        if (new TextEncoder().encode(data).length > MAX_IMPORT_BYTES) throw new FoxprefsError("too-large", `The import is larger than ${MAX_IMPORT_BYTES / 1024} KB.`);
        try {
          raw = JSON.parse(data);
        } catch {
          throw new FoxprefsError("bad-import", "The import is not valid: it is not JSON.");
        }
      }
      const next = checkState(schema, raw, "bad-import");
      return serial(() => store.write({ ...next, updatedAt: new Date(now()).toISOString() }));
    },
  };
  return Object.freeze(prefs);
}
