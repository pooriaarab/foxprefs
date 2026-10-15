// One error type with a code, so callers can tell a bad value from a broken store.

export type FoxprefsErrorCode =
  | "unknown-field"
  | "bad-value"
  | "bad-schema"
  | "bad-store"
  | "bad-import"
  | "too-large"
  | "bad-request";

export class FoxprefsError extends Error {
  readonly code: FoxprefsErrorCode;
  constructor(code: FoxprefsErrorCode, message: string) {
    super(message);
    this.name = "FoxprefsError";
    this.code = code;
  }
}
