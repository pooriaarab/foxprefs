// Passes requests from the test page to this stand-in's background page.
// Each copy answers only requests sent to its own role.
const role = browser.runtime.getManifest().name;
window.addEventListener("message", async (event) => {
  if (event.source !== window || event.data?.fpf !== "scent" || event.data.role !== role) return;
  const result = await browser.runtime.sendMessage({ to: event.data.to, message: event.data.msg });
  window.postMessage({ fpf: "scent-reply", id: event.data.id, result }, "*");
});
document.documentElement.dataset[role] = "ready";
