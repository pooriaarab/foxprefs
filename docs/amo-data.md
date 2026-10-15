# What the foxprefs add-on sends, and its AMO data declaration

The manifest declares `data_collection_permissions: { "required": ["none"] }`.
This page lists everything that the add-on in `extension/` sends out of the
add-on, and why no AMO data type applies to it.

AMO's add-on policies define data transmission as data "collected, used,
transferred, shared, or handled outside of the add-on or the local browser".
The data types for the manifest key are listed at
https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/.

## What leaves the add-on

| What | To where | Why no data type applies |
|---|---|---|
| SCENT answers (`scent.list`, `scent.read`) | The foxscope add-on (`foxscope@pooriaarab`), in the same browser | It stays in the local browser. foxscope asks the user before it passes an "ask" field to an agent; foxscope declares its own data use. Private fields are never sent. |
| The copy-for-agent text | The clipboard, when the user presses the button | The user moves it. The add-on sends nothing itself. |
| The export file | A download, when the user presses Export | The user saves it. |
| "Fill my size" | The size menus of the current tab, after the user's click | The values go into a page form in this browser. The add-on reads no page content back except whether a menu matched. |

The add-on makes no network requests and has no `host_permissions` in the
release build. The E2E build (`dist-e2e/`) adds host permissions for the
test site only; release.yml signs `dist-ext/`.

If a later change sends data off the browser, the same change must add the
matching data types to `data_collection_permissions`.
