// The Firefox E2E test. It installs dist-e2e/ (the extension plus host
// permissions for the test site) and two stand-in extensions from
// e2e/scent-ext/: one with the id foxscope@pooriaarab, one with another id.
// It drives the real settings page, then checks the copy-for-agent text,
// the SCENT answers to each stand-in, and "Fill my size" on a test shop.
// Writes artifacts/e2e-<date>.json after the checks.
// Usage: pnpm e2e [--headed]. Env: FIREFOX, or FOXKIT_BROWSER=ichabod with ICHABOD_API_KEY.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { browserMode, launch, poll, serve, writeArtifact } from "create-foxkit/e2e";

const record = { startedAt: new Date().toISOString(), mode: browserMode(), checks: [] };
const check = (name, expected, actual) => record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = (name) => `[data-field="${name}"]`;
const STUBS = { foxscope: "foxscope@pooriaarab", intruder: "intruder@foxprefs.test" };

/** A stand-in extension directory for one role. MV2, so its content script needs no host grant. */
function stub(role) {
  const dir = mkdtempSync(join(tmpdir(), `fpf-${role}-`));
  for (const f of readdirSync("e2e/scent-ext")) writeFileSync(join(dir, f), readFileSync(join("e2e/scent-ext", f)));
  const manifest = {
    manifest_version: 2, name: role, version: "1.0",
    browser_specific_settings: { gecko: { id: STUBS[role] } },
    background: { scripts: ["background.js"] },
    content_scripts: [{ matches: ["http://127.0.0.1/*", "https://*.trycloudflare.com/*"], js: ["content.js"] }],
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

const head = (sig, size) => {
  const b = Buffer.alloc(size);
  b.writeUInt32LE(sig, 0);
  return b;
};

/** A stored (not deflated) zip of a flat directory, for webExtension.install on Ichabod. */
function zip(dir) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const name of readdirSync(dir)) {
    const data = readFileSync(join(dir, name));
    const local = head(0x04034b50, 30);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = head(0x02014b50, 46);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    local.copy(entry, 8, 6, 30);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, Buffer.from(name), data);
    central.push(entry, Buffer.from(name));
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

async function install(fox, dir) {
  if (browserMode() === "local") return fox.browser.installExtension(dir);
  // Puppeteer types connection for CDP only; on BiDi it sends raw BiDi commands.
  return fox.browser.connection.send("webExtension.install", { extensionData: { type: "base64", value: zip(dir).toString("base64") } });
}

/** Ask one stand-in to send a SCENT message to foxprefs, from the test page. */
const scent = (page, role, msg, to) =>
  page.evaluate(
    (r, m, t) =>
      new Promise((done) => {
        const id = Math.random().toString(36).slice(2);
        const onReply = (e) => {
          if (e.data?.fpf !== "scent-reply" || e.data.id !== id) return;
          window.removeEventListener("message", onReply);
          done(e.data.result);
        };
        window.addEventListener("message", onReply);
        window.postMessage({ fpf: "scent", role: r, id, msg: m, to: t }, "*");
      }),
    role,
    msg,
    to,
  );

const site = await serve("e2e/site");
let fox;
try {
  fox = await launch({ extension: "dist-e2e", headless: !process.argv.includes("--headed") });
  record.firefox = await fox.browser.version();
  for (const role of Object.keys(STUBS)) await install(fox, stub(role));

  // 1. Set sizes, diet, budget and more through the real settings page.
  let settings = await fox.openExtensionPage("settings.html");
  await poll(settings, () => Boolean(document.querySelector('[data-field="shopping.size.top"]')));
  const statusText = () => settings.evaluate(() => document.getElementById("status").textContent);
  async function enter(name, text) {
    const isSelect = await settings.$eval(sel(name), (el) => el.tagName === "SELECT");
    if (isSelect) await settings.select(sel(name), text);
    else {
      await settings.$eval(sel(name), (el) => (el.value = ""));
      await settings.type(sel(name), text);
      await settings.$eval(sel(name), (el) => el.dispatchEvent(new Event("change")));
    }
    await sleep(300);
    return statusText();
  }
  check("top size saves", "Saved top size.", await enter("shopping.size.top", "M"));
  check("shoe size saves", "Saved shoe size.", await enter("shopping.size.shoe", "US 9"));
  check("diet saves", "Saved diet.", await enter("food.diet", "vegetarian"));
  check("allergies save (an ask field)", "Saved allergies.", await enter("food.allergies", "peanuts"));
  check("loyalty number saves (a private field)", "Saved loyalty numbers.", await enter("travel.loyalty", "Aeroplan 123456789"));
  check("budget saves", "Saved usual budget per purchase.", await enter("budget.perPurchase", "80 usd"));
  check("hard cap saves", "Saved never buy over.", await enter("rules.maxPurchase", "200 USD"));

  // 2. Validation: a bad value shows its error and is not stored (E2).
  check("money with no currency is refused", "Monthly budget was not saved.", await enter("budget.monthly", "600"));
  check("the error shows under the field", '"600" is not an amount with a currency, like 200 USD.', await settings.$eval('[data-error="budget.monthly"]', (el) => el.textContent));
  check("the bad field is marked invalid", "true", await settings.$eval(sel("budget.monthly"), (el) => el.getAttribute("aria-invalid")));
  check("a time zone that does not exist is refused", "Time zone was not saved.", await enter("identity.timeZone", "Mars/Base"));

  // 3. Reload: the values persist and the bad ones were never stored (E1).
  await settings.close();
  settings = await fox.openExtensionPage("settings.html");
  await poll(settings, () => Boolean(document.querySelector('[data-field="shopping.size.top"]')));
  const shown = await settings.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-field]")].map((el) => [el.dataset.field, el.value]).filter(([, v]) => v)));
  check("values persist after a reload", { "shopping.size.top": "M", "shopping.size.shoe": "US 9", "food.diet": "vegetarian", "food.allergies": "peanuts", "travel.loyalty": "Aeroplan 123456789", "budget.perPurchase": "80.00 USD", "rules.maxPurchase": "200.00 USD" }, shown);

  // 4. Copy for an agent: public prefs only (E3).
  const copy = async () => {
    await settings.evaluate(() => (document.getElementById("agent-text").textContent = ""));
    await settings.click("#copy");
    return poll(settings, () => document.getElementById("agent-text").textContent);
  };
  let text = await copy();
  record.agentText = text;
  check("agent text has the public prefs", [true, true, true, true], ["- Top size: M", "- Shoe size: US 9", "- Diet: vegetarian", "- Never spend more than 200.00 USD on one purchase."].map((s) => text.includes(s)));
  check("agent text has no ask or private value", [false, false, false], ["peanuts", "Aeroplan", "80.00"].map((s) => text.includes(s)));
  await settings.select('[data-sensitivity="shopping.size.shoe"]', "private");
  await sleep(300);
  check("the level badge changes", "private", await settings.$eval('[data-sensitivity="shopping.size.shoe"]', (el) => el.dataset.level));
  text = await copy();
  check("a field made private leaves the agent text", false, text.includes("US 9"));

  // 5. SCENT over onMessageExternal: foxscope gets data, any other extension nothing (R1, R2, R4).
  const page = await fox.open(`${site.url}/scent.html`);
  await poll(page, () => document.documentElement.dataset.foxscope && document.documentElement.dataset.intruder);
  const fields = ["prefs.shopping.size.top", "prefs.shopping.size.shoe", "prefs.food.allergies", "prefs.travel.loyalty", "prefs.budget.perPurchase"];
  const list = await scent(page, "foxscope", { type: "scent.list" });
  check("foxscope lists the fields", [true, 28, false], [list.sent, list.value?.length, JSON.stringify(list).includes("Aeroplan")]);
  check("foxscope reads granted fields, derived, with no private field", { "prefs.shopping.size.top": "M", "prefs.food.allergies": ["peanuts"], "prefs.budget.perPurchase": "mid" }, (await scent(page, "foxscope", { type: "scent.read", fields, derive: true })).value);
  check("foxscope reads the exact budget without derive", { value: 8000, currency: "USD" }, (await scent(page, "foxscope", { type: "scent.read", fields, derive: false })).value?.["prefs.budget.perPurchase"]);
  const intruder = [await scent(page, "intruder", { type: "scent.list" }), await scent(page, "intruder", { type: "scent.read", fields, derive: false })];
  record.intruder = intruder;
  check("another extension gets no data", [undefined, undefined], intruder.map((r) => r.value));
  const absent = await scent(page, "intruder", { type: "scent.list" }, "nobody@foxprefs.test");
  record.absent = absent;
  check("another extension gets an error", [false, false], intruder.map((r) => r.sent));
  check("the error is the one for an extension that is not installed", [absent.error, absent.error], intruder.map((r) => r.error));

  // 6. Fill my size on a shop page, and nothing on a page with no match (E5, E6).
  const fill = async (path) => {
    const shop = await fox.open(`${site.url}/${path}`);
    const tabId = await settings.evaluate(async (p) => (await browser.tabs.query({})).find((t) => t.url?.endsWith(p))?.id, path);
    const result = await settings.evaluate((id) => browser.runtime.sendMessage({ type: "prefs:fill", tabId: id }), tabId);
    const values = await shop.evaluate(() => Object.fromEntries([...document.querySelectorAll("select")].map((s) => [s.id, s.value])));
    return { result, values };
  };
  const shop = await fill("shop.html");
  check("fill my size sets the size and shoe selects only", { size: "m", shoe: "9", color: "" }, shop.values);
  check("fill my size reports what it set", { ok: true, value: { filled: [{ kind: "top", value: "Medium" }, { kind: "shoe", value: "9" }], missed: [] } }, shop.result);
  const xs = await fill("shop-xs.html");
  check("no matching option: nothing changes", { size: "" }, xs.values);
  check("no matching option: it says so", ["top"], xs.result?.value?.missed);
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
} finally {
  await fox?.close();
  await site.close();
}

record.passed = !record.error && record.checks.length > 0 && record.checks.every((c) => c.ok);
mkdirSync("artifacts", { recursive: true });
const path = writeArtifact("artifacts", "e2e", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}: ${JSON.stringify(c.actual)}`);
console.log(`${record.passed ? "PASS" : "FAIL"} ${record.checks.filter((c) => c.ok).length}/${record.checks.length}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;
