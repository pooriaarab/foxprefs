# Failure modes

Every way foxprefs can fail, written before the code. Each row names the
test that covers it. Prefer an E2E check. Write an isolated test only when an
E2E check cannot reach the failure.

foxprefs holds what a person told it about themselves. The worst failures
are a value that leaves when it must not, and a value that is wrong without
an error. So foxprefs fails loudly: it throws, it does not guess, and it
never resets a store that it cannot read.

## Values and the schema

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| S1 | A value has the wrong type, for example a number for an enum field or `"yes"` for a boolean | `set` throws `bad-value` and names the field and the type it wants; the store does not change | tests/values.test.ts |
| S2 | An enum value is not one of the options (`size.top: "XXXL"`) | `bad-value` lists the options | tests/values.test.ts |
| S3 | A field name is unknown or misspelled (`shoping.size.top`) | `unknown-field`; no new key is stored | tests/values.test.ts |
| S4 | A string holds a newline or another control character, which could start a new line of instructions in an agent prompt | `bad-value` | tests/values.test.ts |
| S5 | A string or list is huge (a 1 MB string, 10 000 list items) | `bad-value` above the field limit (120 characters, 50 items of 100 characters) | tests/values.test.ts |
| S6 | Money has a fraction of a minor unit (`19.999 USD`), a negative amount, a lowercase or unknown currency | `bad-value`; money is a whole number of minor units and an ISO 4217 code | tests/values.test.ts |
| S7 | Text input is ambiguous (`"200"` for money with no currency, `"maybe"` for a boolean) | `parseValue` throws `bad-value`; it never picks a default currency or a default answer | tests/values.test.ts |
| S8 | A language tag or a time zone does not exist (`en-XX-bad`, `Mars/Base`) | `bad-value` from the `Intl` check | tests/values.test.ts |
| S9 | A custom schema has two fields with one name, a bad name, or an enum with no options | `defineSchema` throws `bad-schema` | tests/values.test.ts |
| S10 | A `derive` function throws or returns a value that is not JSON | `get` with `derive` throws; it does not return the raw value in its place | tests/prefs.test.ts |

## The prefs object and its store

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| P1 | The store holds a corrupt record (not JSON, wrong format tag, a value that fails its field check) | Every call throws `bad-store`. foxprefs never writes over it, so the user can still save the file | tests/prefs.test.ts, tests/node.test.ts |
| P2 | Two `set` calls run at the same time in one process | Both land; calls on one prefs object run one at a time | tests/prefs.test.ts |
| P3 | The store write fails | `set` rejects; a later `get` shows the old value | tests/prefs.test.ts |
| P4 | A caller changes an object that `get` or `all` returned | The stored value does not change (copies, not references) | tests/prefs.test.ts |
| P5 | A sensitivity is not `public`, `ask` or `private` | `bad-value` | tests/prefs.test.ts |
| P6 | `unset` on a field that has no value | No error, no write | tests/prefs.test.ts |

## Export and import (`foxprefs/v1`)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| X1 | The import is not JSON, or has another format tag (`foxprefs/v2`, none) | `bad-import`; nothing changes | tests/prefs.test.ts |
| X2 | The import is huge (over 256 KB) | `too-large` before `JSON.parse` | tests/prefs.test.ts |
| X3 | One value in the import is bad, or names an unknown field | `bad-import` names the field; nothing changes (no half import) | tests/prefs.test.ts |
| X4 | The import holds `__proto__` or `constructor` keys | They are refused as unknown fields; no prototype changes | tests/prefs.test.ts |
| X5 | An export followed by an import changes a value | The round trip is exact | tests/prefs.test.ts |

## What an agent gets

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| O1 | `toPrompt` puts a private or an ask field in the agent text | Only public fields reach the text | tests/outputs.test.ts, E2E |
| O2 | `toPrompt` names an unknown field | `unknown-field` | tests/outputs.test.ts |
| O3 | `toRules` makes a rule that foxgate refuses or reads in another way | The rules go into a real foxgate and it denies a purchase over the cap and an action on a blocked site | tests/outputs.test.ts |
| O4 | A monthly cap uses another currency than the purchase | foxgate denies it (`currency`); foxprefs does not convert | tests/outputs.test.ts |
| O5 | `toHcp` carries a private value | Private fields appear with `read: "Never"` and no value | tests/outputs.test.ts |
| R1 | The SCENT resolver returns a private field, also with `derive: true` | It is left out | tests/scent.test.ts |
| R2 | `derive: true` returns the exact budget | It returns the band (`low`, `mid` or `high`) | tests/scent.test.ts |
| R3 | A field outside the `prefs.` namespace, or an unknown one | Left out, never an error that tells which fields exist | tests/scent.test.ts |
| R4 | An extension other than `foxscope@pooriaarab` sends `scent.list` or `scent.read` | No reply, the same as when foxprefs is not installed | tests/scent.test.ts, E2E |
| R5 | foxscope sends a bad message (no type, fields not a list, 10 000 fields) | No data; a `bad-request` error | tests/scent.test.ts |
| R6 | A web page sends a message | Firefox does not deliver page messages to `onMessageExternal`; foxprefs has no `externally_connectable` | E2E (manifest) |
| R7 | foxscope honors an expired grant | Out of scope here: foxprefs keeps no grants. foxscope owns consent, expiry and the trail | — |

## Node store, CLI and MCP server

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| N1 | `FOXPREFS_HOME` is not set | The store is `~/.foxprefs/prefs.json` | tests/node.test.ts |
| N2 | A crash during a write leaves half a file | Writes go to a temp file and then `rename`, so the old file stays whole | tests/node.test.ts |
| N3 | Other users on the computer read the file | The directory is `0700` and the file `0600` | tests/node.test.ts |
| N4 | Two CLI processes write at the same time | The last write wins. Documented limit, no lock | — |
| C1 | A CLI command or flag is unknown, or an argument is missing | Exit 2 with the usage | tests/cli.test.ts |
| C2 | A value is bad | Exit 1 with the field error; nothing changes | tests/cli.test.ts |
| C3 | `import` gets a file that does not exist | Exit 1 with the path | tests/cli.test.ts |
| M1 | An agent reads a private or an ask field over MCP | Private: "private, never shared". Ask: "needs a grant, use foxscope". Never the value | tests/mcp.test.ts |
| M2 | An agent tries to write a preference over MCP | There is no write tool | tests/mcp.test.ts |

## Extension

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| E1 | A value does not persist after a reload | Values live in `storage.local` | E2E |
| E2 | The settings page saves a bad value | The field shows the error message; the stored value does not change | E2E |
| E3 | The copy-for-agent text has a private value | It is `toPrompt()`, so only public values | E2E |
| E4 | A content script of this extension calls the settings messages | The background answers its own extension pages only | E2E |
| E5 | "Fill my size" runs on a page without a click | It runs only from the popup button, with `activeTab`; no content script is declared in the release build | E2E |
| E6 | A size control has no option that matches | Nothing is changed and the popup says so | E2E |
