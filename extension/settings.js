// The settings page: one form row per field. A value saves when it changes;
// the event page checks it, and a bad value shows its error and is not stored.
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxprefs did not answer.");
  return reply.value;
};
const $ = (id) => document.getElementById(id);
const GROUPS = { identity: "About you", shopping: "Shopping", food: "Food", travel: "Travel", budget: "Budget", communication: "How agents answer you", accessibility: "Accessibility", rules: "Hard rules" };
const LEVELS = ["public", "ask", "private"];

function status(text, bad = false) {
  $("status").textContent = text;
  $("status").classList.toggle("bad", bad);
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

/** The value control for a field: a select for enums and yes/no, else text. */
function control(f) {
  const id = `f-${f.name}`;
  if (f.type === "enum" || f.type === "boolean") {
    const choices = f.type === "enum" ? f.options : ["yes", "no"];
    const select = el("select", { id }, [el("option", { value: "", textContent: "Not set" }), ...choices.map((c) => el("option", { value: c, textContent: c }))]);
    select.value = f.text ?? "";
    return select;
  }
  const placeholder = f.hint ?? (f.type === "list" ? "Separate items with commas" : f.type === "money" ? "200 USD" : "");
  return el("input", { id, type: "text", value: f.text ?? "", placeholder, autocomplete: "off", spellcheck: false });
}

function row(f) {
  const input = control(f);
  input.dataset.field = f.name;
  const error = el("p", { className: "error", role: "alert" });
  error.dataset.error = f.name;
  input.setAttribute("aria-describedby", (error.id = `e-${f.name}`));
  const sens = el("select", { className: "sens", title: "Who can read this" }, LEVELS.map((l) => el("option", { value: l, textContent: l })));
  sens.value = sens.dataset.level = f.sensitivity;
  sens.dataset.sensitivity = f.name;
  sens.setAttribute("aria-label", `Who can read ${f.label}`);

  input.addEventListener("change", async () => {
    try {
      const saved = await ask("prefs:set", { field: f.name, text: input.value });
      input.value = saved.text ?? "";
      input.removeAttribute("aria-invalid");
      error.textContent = "";
      status(`Saved ${f.label.toLowerCase()}.`);
    } catch (e) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = e.message.replace(`${f.name}: `, "");
      status(`${f.label} was not saved.`, true);
    }
  });
  sens.addEventListener("change", async () => {
    try {
      const saved = await ask("prefs:sensitivity", { field: f.name, sensitivity: sens.value });
      sens.dataset.level = saved.sensitivity;
      status(`${f.label} is ${saved.sensitivity} now.`);
    } catch (e) {
      status(e.message, true);
    }
  });
  return el("div", { className: "field" }, [el("label", { htmlFor: input.id, textContent: f.label }), input, sens, error]);
}

async function render() {
  const fields = await ask("prefs:all");
  const sets = Object.keys(GROUPS).map((g) => el("fieldset", {}, [el("legend", { textContent: GROUPS[g] }), ...fields.filter((f) => f.group === g).map(row)]));
  $("form").replaceChildren(...sets);
}

$("form").addEventListener("submit", (e) => e.preventDefault());

$("copy").addEventListener("click", async () => {
  const text = await ask("prefs:prompt");
  $("agent-text").textContent = text;
  $("agent-text").hidden = false;
  try {
    await navigator.clipboard.writeText(text);
    status("Copied. Paste it into your agent's instructions. It has your public fields only.");
  } catch {
    status("Select the text below and copy it. It has your public fields only.");
  }
});

$("export").addEventListener("click", async () => {
  const data = await ask("prefs:export");
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" }));
  el("a", { href: url, download: `foxprefs-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("Exported. The file has every value, also the private ones. Keep it safe.");
});

$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files?.[0];
  $("import-file").value = "";
  if (!file) return;
  try {
    await ask("prefs:import", { text: await file.text() });
    await render();
    status(`Imported ${file.name}.`);
  } catch (e) {
    status(e.message, true);
  }
});

render().catch((e) => status(e.message, true));
