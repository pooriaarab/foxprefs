// The popup: the most-used preferences, "Copy for an agent", and "Fill my size",
// which fills size selects on the active tab only when the user clicks it.
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxprefs did not answer.");
  return reply.value;
};
const $ = (id) => document.getElementById(id);
const QUICK = ["shopping.size.top", "shopping.size.bottom", "shopping.size.shoe", "food.diet", "food.allergies", "travel.seat", "rules.maxPurchase"];
const status = (text) => ($("status").textContent = text);

async function render() {
  const byName = new Map((await ask("prefs:all")).map((f) => [f.name, f]));
  const rows = QUICK.map((n) => byName.get(n)).flatMap((f) => {
    const dt = Object.assign(document.createElement("dt"), { textContent: f.label });
    const dd = Object.assign(document.createElement("dd"), { textContent: f.text ?? "Not set" });
    dd.dataset.field = f.name;
    dd.classList.toggle("unset", f.text === undefined);
    if (f.sensitivity !== "public") dd.append(Object.assign(document.createElement("span"), { className: `level ${f.sensitivity}`, textContent: f.sensitivity }));
    return [dt, dd];
  });
  $("quick").replaceChildren(...rows);
}

$("copy").addEventListener("click", async () => {
  const text = await ask("prefs:prompt");
  $("agent-text").textContent = text;
  $("agent-text").hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    status("Copied. It has your public fields only.");
  } catch {
    status("Select the text below and copy it.");
  }
});

$("fill").addEventListener("click", async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const result = await ask("prefs:fill", { tabId: tab.id });
    if (result.noSizes) status("Set your sizes in the settings first.");
    else if (result.filled.length) status(`Filled ${result.filled.map((f) => `${f.kind} size ${f.value}`).join(", ")}.`);
    else status(result.missed.length ? "This page has no option that matches your size. Nothing changed." : "No size control found on this page.");
  } catch (e) {
    status(`Cannot fill this page: ${e.message}`);
  }
});

render().catch((e) => status(e.message));
