// P1-P8, X1-X6 and S10 in docs/failure-modes.md.
import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEMA, FoxprefsError, createPrefs, defineSchema, memoryStore, prefsResolver, storageAreaStore, type PrefStore, type PrefsState } from "../src/index.js";

const fresh = () => {
  const store = memoryStore();
  return { store, prefs: createPrefs({ store, now: () => Date.UTC(2026, 9, 15) }) };
};
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error instanceof FoxprefsError ? `${error.code}: ${error.message}` : `other: ${String(error)}`;
  }
  return "no error";
};

describe("createPrefs", () => {
  it("sets, gets and unsets values", async () => {
    const { prefs } = fresh();
    await prefs.set("shopping.size.top", "M");
    await prefs.setText("budget.perPurchase", "80 USD");
    expect(await prefs.get(["shopping.size.top", "budget.perPurchase", "food.diet"])).toEqual({ "shopping.size.top": "M", "budget.perPurchase": { value: 8000, currency: "USD" } });
    await prefs.unset("shopping.size.top");
    expect(await prefs.get(["shopping.size.top"])).toEqual({});
  });

  it("S1 S3 a bad value or an unknown field rejects, and the store does not change", async () => {
    const { prefs, store } = fresh();
    await prefs.set("food.diet", "vegan");
    const before = JSON.stringify(await store.read());
    expect(await rejects(prefs.set("food.diet", "carnivore"))).toMatch(/^bad-value: food\.diet: must be one of/);
    expect(await rejects(prefs.set("shoping.size.top", "M"))).toBe('unknown-field: "shoping.size.top" is not a preference field.');
    expect(await rejects(prefs.get(["nope.nope"]))).toMatch(/^unknown-field/);
    expect(JSON.stringify(await store.read())).toBe(before);
  });

  it("P1 a corrupt store fails every call and is never written over", async () => {
    for (const bad of [{ format: "foxprefs/v2", values: {}, sensitivity: {} }, "not an object", { format: "foxprefs/v1", values: { "food.diet": "carnivore" }, sensitivity: {} }]) {
      let writes = 0;
      const store: PrefStore = { read: async () => bad, write: async () => void writes++ };
      const prefs = createPrefs({ store });
      expect(await rejects(prefs.all())).toMatch(/^bad-store: The stored preferences are not valid/);
      expect(await rejects(prefs.set("food.diet", "vegan"))).toMatch(/^bad-store/);
      expect(writes).toBe(0);
    }
  });

  it("P7 an unknown field in the store is kept in the file and never served", async () => {
    const stored = { format: "foxprefs/v1", values: { "food.diet": "vegan", "pets.kind": "tabby" }, sensitivity: { "pets.kind": "public" }, updatedAt: "2026-10-01T00:00:00.000Z" } as const;
    const store = memoryStore(stored as PrefsState);
    const prefs = createPrefs({ store, now: () => Date.UTC(2026, 9, 15) });
    expect(await prefs.unknownFields()).toEqual(["pets.kind"]);
    expect((await prefs.all()).map((f) => f.name)).toEqual(DEFAULT_SCHEMA.map((f) => f.name));
    expect(await prefs.get(["food.diet"])).toEqual({ "food.diet": "vegan" });
    expect(await rejects(prefs.get(["pets.kind"]))).toMatch(/^unknown-field/);
    const resolver = prefsResolver(prefs);
    const served = [await prefs.toPrompt(), await prefs.toRules(), await prefs.toHcp(), await resolver.list(), await resolver.read(["prefs.pets.kind", "prefs.food.diet"], { derive: false })];
    expect(served.map((x) => JSON.stringify(x)).filter((x) => /pets|tabby/.test(x))).toEqual([]);
    await prefs.set("food.diet", "halal");
    expect(await store.read()).toEqual({ ...stored, values: { "food.diet": "halal", "pets.kind": "tabby" }, sensitivity: {}, updatedAt: "2026-10-15T00:00:00.000Z" });
    expect((await prefs.export()).values["pets.kind"]).toBe("tabby");
  });

  it("P8 a sensitivity for an unknown field never takes effect when the schema adds it", async () => {
    const store = memoryStore();
    await createPrefs({ store }).import({ format: "foxprefs/v1", values: { "payment.card": "4111 1111 1111 1111" }, sensitivity: { "payment.card": "public" } });
    const card = { name: "payment.card", label: "Card", type: "string", sensitivity: "private" } as const;
    const later = createPrefs({ store, schema: defineSchema([...DEFAULT_SCHEMA, card]) });
    expect((await later.all()).find((f) => f.name === "payment.card")?.sensitivity).toBe("private");
    expect(await later.toPrompt()).not.toMatch(/4111/);
    expect(await prefsResolver(later).read(["prefs.payment.card"], { derive: false })).toEqual({});
    const loaded = memoryStore({ format: "foxprefs/v1", values: {}, sensitivity: { "payment.card": "public" }, updatedAt: "2026-10-01T00:00:00.000Z" });
    const prefs = createPrefs({ store: loaded });
    expect(await prefs.unknownFields()).toEqual([]);
    expect((await prefs.export()).sensitivity).toEqual({});
    await prefs.set("food.diet", "vegan");
    expect(((await loaded.read()) as PrefsState).sensitivity).toEqual({});
  });

  it("P2 two sets at the same time both land", async () => {
    const { prefs } = fresh();
    await Promise.all([prefs.set("shopping.size.top", "L"), prefs.set("food.diet", "vegetarian"), prefs.set("travel.seat", "aisle")]);
    expect(Object.keys(await prefs.get(["shopping.size.top", "food.diet", "travel.seat"]))).toHaveLength(3);
  });

  it("P3 a failed write rejects and the old value stays", async () => {
    const inner = memoryStore();
    let broken = false;
    const store: PrefStore = { read: inner.read, write: async (s) => (broken ? Promise.reject(new Error("disk full")) : inner.write(s)) };
    const prefs = createPrefs({ store });
    await prefs.set("food.diet", "vegan");
    broken = true;
    expect(await rejects(prefs.set("food.diet", "halal"))).toBe("other: Error: disk full");
    expect(await prefs.get(["food.diet"])).toEqual({ "food.diet": "vegan" });
  });

  it("P4 returned objects are copies", async () => {
    const { prefs } = fresh();
    await prefs.set("food.dislikes", ["olives"]);
    const got = await prefs.get(["food.dislikes"]);
    (got["food.dislikes"] as string[]).push("kale");
    const listed = (await prefs.all()).find((f) => f.name === "food.dislikes");
    (listed!.value as string[]).push("tofu");
    expect(await prefs.get(["food.dislikes"])).toEqual({ "food.dislikes": ["olives"] });
  });

  it("P5 sensitivity changes are checked and shown in all()", async () => {
    const { prefs } = fresh();
    await prefs.setSensitivity("shopping.size.top", "private");
    expect((await prefs.all()).find((f) => f.name === "shopping.size.top")?.sensitivity).toBe("private");
    expect(await rejects(prefs.setSensitivity("shopping.size.top", "secret" as never))).toMatch(/^bad-value: .*not public, ask or private/);
  });

  it("P6 unset of an empty field does not write", async () => {
    let writes = 0;
    const inner = memoryStore();
    const prefs = createPrefs({ store: { read: inner.read, write: async (s) => (writes++, inner.write(s)) } });
    await prefs.unset("food.diet");
    expect(writes).toBe(0);
  });

  it("S10 a derive that throws fails the read, and never gives the raw value", async () => {
    const schema = defineSchema([{ name: "a.b", label: "A", type: "string", sensitivity: "public", derive: (() => { throw new Error("boom"); }) as never }]);
    const prefs = createPrefs({ store: memoryStore(), schema });
    await prefs.set("a.b", "secret detail");
    expect(await rejects(prefs.get(["a.b"], { derive: true }))).toBe("bad-value: a.b: derive failed: boom.");
    expect(await prefs.get(["a.b"])).toEqual({ "a.b": "secret detail" });
  });

  it("derive gives the budget band", async () => {
    const { prefs } = fresh();
    await prefs.setText("budget.perPurchase", "80 USD");
    await prefs.setText("budget.monthly", "3000 USD");
    expect(await prefs.get(["budget.perPurchase", "budget.monthly"], { derive: true })).toEqual({ "budget.perPurchase": "mid", "budget.monthly": "high" });
  });

  it("works on a WebExtension-like storage area", async () => {
    const data: Record<string, unknown> = {};
    const area = { get: async (k: string) => ({ [k]: data[k] }), set: async (items: Record<string, unknown>) => void Object.assign(data, items) };
    await createPrefs({ store: storageAreaStore(area) }).set("travel.redeye", false);
    expect(await createPrefs({ store: storageAreaStore(area) }).get(["travel.redeye"])).toEqual({ "travel.redeye": false });
  });
});

describe("export and import", () => {
  it("X5 the round trip is exact", async () => {
    const a = fresh().prefs;
    await a.set("food.allergies", ["peanuts"]);
    await a.setText("rules.maxPurchase", "200 USD");
    await a.setSensitivity("food.diet", "private");
    const exported = await a.export();
    expect(exported.format).toBe("foxprefs/v1");
    const b = fresh().prefs;
    await b.import(JSON.stringify(exported));
    expect(await b.export()).toEqual(exported);
  });

  it("X1 X3 a bad import changes nothing", async () => {
    const { prefs, store } = fresh();
    await prefs.set("food.diet", "vegan");
    const before = JSON.stringify(await store.read());
    const base = { format: "foxprefs/v1", values: {}, sensitivity: {} };
    expect(await rejects(prefs.import("{nope"))).toBe("bad-import: The import is not valid: it is not JSON.");
    expect(await rejects(prefs.import({ ...base, format: "foxprefs/v2" }))).toMatch(/the format must be "foxprefs\/v1"/);
    expect(await rejects(prefs.import({ ...base, values: { "food.diet": "halal", "food.allergies": "peanuts" } }))).toMatch(/food\.allergies: must be a list/);
    expect(JSON.stringify(await store.read())).toBe(before);
  });

  it("X4 X6 an unknown field in an import is kept as data and never served", async () => {
    const { prefs, store } = fresh();
    await prefs.import('{"format":"foxprefs/v1","values":{"pets.kind":"cat","__proto__":{"x":1},"constructor":"x","food.diet":"vegan"},"sensitivity":{"constructor":"public"}}');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(await prefs.unknownFields()).toEqual(["pets.kind", "__proto__", "constructor"]);
    expect(await prefs.get(["food.diet"])).toEqual({ "food.diet": "vegan" });
    expect(JSON.stringify(await prefs.all())).not.toMatch(/pets|__proto__|constructor/);
    const saved = (await store.read()) as PrefsState;
    expect(Object.keys(saved.values).toSorted()).toEqual(["__proto__", "constructor", "food.diet", "pets.kind"]);
    expect(saved.sensitivity).toEqual({});
    expect(Object.getPrototypeOf(saved.values)).toBe(Object.prototype);
    const b = fresh().prefs;
    await b.import(JSON.stringify(await prefs.export()));
    expect(await b.export()).toEqual(await prefs.export());
  });

  it("X2 a huge import is refused before parsing", async () => {
    const { prefs } = fresh();
    expect(await rejects(prefs.import(" ".repeat(256 * 1024 + 1)))).toBe("too-large: The import is larger than 256 KB.");
  });

  it("has every default field in all()", async () => {
    expect((await fresh().prefs.all()).map((f) => f.name)).toEqual(DEFAULT_SCHEMA.map((f) => f.name));
  });
});
