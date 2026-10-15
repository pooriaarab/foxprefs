// foxprefs: typed preferences that an AI agent can read on the user's terms.
export { FoxprefsError, type FoxprefsErrorCode } from "./errors.js";
export { DEFAULT_SCHEMA, GROUPS, SENSITIVITIES, currencyDigits, defineSchema, groupOf } from "./schema.js";
export type { FieldType, Money, PrefField, Schema, Sensitivity } from "./schema.js";
export { MAX_ITEM, MAX_ITEMS, MAX_TEXT, formatMoney, formatValue, parseValue, validateValue } from "./values.js";
