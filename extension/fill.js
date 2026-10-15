// "Fill my size": the popup's button injects this file into the active tab
// (activeTab), then sends the sizes. It is not a declared content script, so
// it never runs on a page by itself. It changes <select> size controls only:
// visible ones, and at most one for each kind (top, bottom, shoe).
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
// A select the user cannot see is not filled: hidden, zero-size, opacity 0
// (on it or a parent), off the page, or cut away by clip-path or clip on it
// or a parent. A page has no reason to clip a real size control, so any
// clip-path or clip counts as hidden; the user can still pick the size.
const clipped = (el) => {
  for (let node = el; node instanceof Element; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.clipPath !== "none" || style.clip !== "auto") return true;
  }
  return false;
};
const visible = (el) => {
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  const box = el.getBoundingClientRect();
  const page = document.documentElement;
  const left = box.left + scrollX;
  const top = box.top + scrollY;
  const onPage = left + box.width > 0 && top + box.height > 0 && left < page.scrollWidth && top < page.scrollHeight;
  return box.width > 0 && box.height > 0 && onPage && !clipped(el);
};
const wanted = (size) => new Set([norm(size), WORDS[size] ? norm(WORDS[size]) : ""].filter(Boolean));

if (!window.foxprefsFill) {
  window.foxprefsFill = true;
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== "foxprefs:fill") return undefined;
    // The first visible select of each kind is the one to fill.
    const targets = new Map();
    for (const el of document.querySelectorAll("select")) {
      const kind = kindOf(el);
      if (kind && message.sizes[kind] && !targets.has(kind) && visible(el)) targets.set(kind, el);
    }
    const filled = [];
    const missed = [];
    for (const [kind, el] of targets) {
      const want = wanted(message.sizes[kind]);
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
