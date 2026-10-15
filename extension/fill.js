// "Fill my size": the popup's button injects this file into the active tab
// (activeTab), then sends the sizes. It is not a declared content script, so
// it never runs on a page by itself. It changes <select> size controls only.
// esbuild wraps this file in a function, so a second injection declares nothing
// twice; the flag keeps it to one listener.
const WORDS = { XXS: "xxsmall", XS: "xsmall", S: "small", M: "medium", L: "large", XL: "xlarge", XXL: "xxlarge" };
const norm = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, "").replace(/^(us|eu|uk)/, "").replace(/^extra/, "x");
const describe = (el) => [el.name, el.id, el.getAttribute("aria-label"), el.labels?.[0]?.textContent, el.closest("label")?.textContent].join(" ").toLowerCase();
const kindOf = (el) => {
  const d = describe(el);
  if (!/size|waist|inseam/.test(d)) return null;
  if (/shoe|foot/.test(d)) return "shoe";
  if (/bottom|waist|pant|trouser|jean|inseam|short/.test(d)) return "bottom";
  return "top";
};
const wanted = (size) => new Set([norm(size), WORDS[size] ? norm(WORDS[size]) : ""].filter(Boolean));

if (!window.foxprefsFill) {
  window.foxprefsFill = true;
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== "foxprefs:fill") return undefined;
    const filled = [];
    const missed = [];
    for (const el of document.querySelectorAll("select")) {
      const kind = kindOf(el);
      const size = kind && message.sizes[kind];
      if (!size) continue;
      const want = wanted(size);
      const option = [...el.options].find((o) => want.has(norm(o.value)) || want.has(norm(o.textContent)));
      if (!option) {
        missed.push(kind);
        continue;
      }
      el.value = option.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled.push({ kind, value: option.textContent.trim() });
    }
    return Promise.resolve({ filled, missed });
  });
}
