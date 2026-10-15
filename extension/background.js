// The event page. It owns the preferences in storage.local, answers the
// extension's own pages, and answers foxscope over onMessageExternal.
// Firefox unloads it when idle; all state is in storage, so a wake is safe.
import { FoxprefsError, answerScent, createPrefs, prefsResolver, storageAreaStore } from "../src/index.ts";

export const prefs = createPrefs({ store: storageAreaStore(browser.storage.local) });
const resolver = prefsResolver(prefs);
const field = async (name) => (await prefs.all()).find((f) => f.name === name);

/** The messages that the settings page and the popup send. */
export const handlers = {
  "prefs:all": () => prefs.all(),
  "prefs:unknown": () => prefs.unknownFields(),
  "prefs:set": async ({ field: name, text }) => {
    if (typeof text !== "string") throw new FoxprefsError("bad-value", `${name}: the value must be text.`);
    if (text.trim() === "") await prefs.unset(name);
    else await prefs.setText(name, text);
    return field(name);
  },
  "prefs:sensitivity": async ({ field: name, sensitivity }) => {
    await prefs.setSensitivity(name, sensitivity);
    return field(name);
  },
  "prefs:prompt": () => prefs.toPrompt(),
  "prefs:export": () => prefs.export(),
  // The popup sends the active tab after a click, which grants activeTab for it.
  // The click is the user's consent for "ask" sizes. A private size never goes
  // into a page, because the page's own script can read the form.
  "prefs:fill": async ({ tabId }) => {
    const fields = new Map((await prefs.all()).map((f) => [f.name, f]));
    const size = (name) => (fields.get(name)?.sensitivity === "private" ? undefined : fields.get(name)?.value);
    const sizes = { top: size("shopping.size.top"), bottom: size("shopping.size.bottom"), shoe: size("shopping.size.shoe") };
    if (!Object.values(sizes).some(Boolean)) return { filled: [], missed: [], noSizes: true };
    await browser.scripting.executeScript({ target: { tabId }, files: ["fill.js"] });
    return browser.tabs.sendMessage(tabId, { type: "foxprefs:fill", sizes });
  },
  "prefs:import": async ({ text }) => {
    if (typeof text !== "string") throw new FoxprefsError("bad-import", "The import must be the text of a file.");
    await prefs.import(text);
    return prefs.all();
  },
};

/** Only this extension's own pages, not content scripts, may read and change the preferences. */
export const fromOwnPage = (sender) => sender?.id === browser.runtime.id && typeof sender.url === "string" && sender.url.startsWith(browser.runtime.getURL(""));

browser.runtime.onMessage.addListener((message, sender) => {
  const handler = Object.hasOwn(handlers, message?.type) ? handlers[message.type] : undefined;
  if (!handler || !fromOwnPage(sender)) return undefined;
  return Promise.resolve()
    .then(() => handler(message))
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, code: error instanceof FoxprefsError ? error.code : "error", error: error instanceof Error ? error.message : String(error) }),
    );
});

// answerScent gives undefined for any sender but foxscope. Firefox would then
// resolve the sender's call with undefined, which tells it that foxprefs is
// installed. So reject with the error Firefox gives when no extension has
// that id: to another extension, foxprefs looks absent (the E2E compares both).
const ABSENT = "Could not establish connection. Receiving end does not exist.";
browser.runtime.onMessageExternal.addListener((message, sender) => answerScent(resolver, sender, message) ?? Promise.reject(new Error(ABSENT)));
