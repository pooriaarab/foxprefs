// foxprefs: typed preferences that an AI agent can read on the user's terms.
export { FoxprefsError, type FoxprefsErrorCode } from "./errors.js";
export { DEFAULT_SCHEMA, GROUPS, SENSITIVITIES, currencyDigits, defineSchema, groupOf } from "./schema.js";
export type { FieldType, Money, PrefField, Schema, Sensitivity } from "./schema.js";
export { MAX_ITEM, MAX_ITEMS, MAX_TEXT, formatMoney, formatValue, parseValue, validateValue } from "./values.js";
export { FORMAT, MAX_IMPORT_BYTES, checkState, createPrefs } from "./prefs.js";
export type { FieldInfo, Prefs, PrefsOptions } from "./prefs.js";
export { memoryStore, storageAreaStore } from "./store.js";
export type { PrefStore, PrefsState, StorageAreaLike } from "./store.js";
export type { GateRule, HcpExport, PrefsRules } from "./outputs.js";
export { FOXSCOPE_ID, MAX_READ_FIELDS, NAMESPACE, answerScent, prefsResolver } from "./scent.js";
export type { ScentField, ScentRequest, ScentResolver, ScentResponse, SenderLike } from "./scent.js";
