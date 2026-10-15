// R1-R5 in docs/failure-modes.md: the SCENT resolver and the external answer.
import { describe, expect, it } from "vitest";
import { FOXSCOPE_ID, answerScent, createPrefs, memoryStore, prefsResolver } from "../src/index.js";

async function setup() {
  const prefs = createPrefs({ store: memoryStore() });
  await prefs.set("shopping.size.top", "M");
  await prefs.set("food.allergies", ["peanuts"]);
  await prefs.set("travel.loyalty", ["Aeroplan 123456789"]);
  await prefs.setText("budget.perPurchase", "300 USD");
  return { prefs, resolver: prefsResolver(prefs) };
}
const ALL = ["prefs.shopping.size.top", "prefs.food.allergies", "prefs.travel.loyalty", "prefs.budget.perPurchase"];

describe("prefsResolver", () => {
  it("lists every field with its namespace and sensitivity, and no values", async () => {
    const { resolver } = await setup();
    const list = await resolver.list();
    expect(resolver.namespace).toBe("prefs");
    expect(list).toContainEqual({ name: "prefs.travel.loyalty", label: "Loyalty numbers", sensitivity: "private", derivable: false });
    expect(list).toContainEqual({ name: "prefs.budget.perPurchase", label: "Usual budget per purchase", sensitivity: "ask", derivable: true });
    expect(JSON.stringify(list)).not.toContain("Aeroplan");
  });

  it("R1 never returns a private field, also with derive", async () => {
    const { resolver, prefs } = await setup();
    for (const derive of [false, true]) expect(Object.keys(await resolver.read(ALL, { derive }))).not.toContain("prefs.travel.loyalty");
    await prefs.setSensitivity("shopping.size.top", "private");
    expect(await resolver.read(["prefs.shopping.size.top"], { derive: false })).toEqual({});
  });

  it("R2 derive gives the band, not the amount", async () => {
    const { resolver } = await setup();
    expect(await resolver.read(ALL, { derive: true })).toEqual({ "prefs.shopping.size.top": "M", "prefs.food.allergies": ["peanuts"], "prefs.budget.perPurchase": "high" });
    expect((await resolver.read(["prefs.budget.perPurchase"], { derive: false }))["prefs.budget.perPurchase"]).toEqual({ value: 30000, currency: "USD" });
  });

  it("R3 leaves out other namespaces, unknown and unset names, without an error", async () => {
    const { resolver } = await setup();
    expect(await resolver.read(["memory.travel", "shopping.size.top", "prefs.nope.nope", "prefs.food.diet", 7 as never], { derive: false })).toEqual({});
  });
});

describe("answerScent", () => {
  it("answers foxscope", async () => {
    const { resolver } = await setup();
    expect(await answerScent(resolver, { id: FOXSCOPE_ID }, { type: "scent.list" })).toHaveLength(28);
    expect(await answerScent(resolver, { id: FOXSCOPE_ID }, { type: "scent.read", fields: ["prefs.shopping.size.top"], derive: false })).toEqual({ "prefs.shopping.size.top": "M" });
  });

  it("R4 gives no answer at all to any other sender", async () => {
    const { resolver } = await setup();
    for (const sender of [{ id: "intruder@example" }, { id: "FOXSCOPE@POORIAARAB" }, {}, null as never]) {
      expect(answerScent(resolver, sender, { type: "scent.list" })).toBeUndefined();
      expect(answerScent(resolver, sender, { type: "scent.read", fields: ALL })).toBeUndefined();
    }
  });

  it("R5 a bad message from foxscope gets no data", async () => {
    const { resolver } = await setup();
    const ask = (m: unknown) => answerScent(resolver, { id: FOXSCOPE_ID }, m);
    expect(ask(null)).toBeUndefined();
    expect(ask({ type: "scent.write", fields: ALL })).toBeUndefined();
    expect(await ask({ type: "scent.read", fields: "prefs.shopping.size.top" })).toEqual({ error: "bad-request: fields must be a list of at most 100 field names." });
    expect(await ask({ type: "scent.read", fields: Array.from({ length: 101 }, () => "prefs.shopping.size.top") })).toHaveProperty("error");
    expect(await ask({ type: "scent.read", fields: ALL, derive: "yes" })).toEqual({ error: "bad-request: derive must be true or false." });
  });
});
