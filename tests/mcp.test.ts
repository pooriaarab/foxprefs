// M1 and M2 in docs/failure-modes.md: the MCP server reads public fields only.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp.js";
import { createPrefs, memoryStore } from "../src/index.js";

async function connect() {
  const prefs = createPrefs({ store: memoryStore() });
  await prefs.set("shopping.size.top", "M");
  await prefs.set("food.allergies", ["peanuts"]);
  await prefs.set("travel.loyalty", ["Aeroplan 123456789"]);
  await prefs.setText("budget.perPurchase", "30 USD");
  await prefs.setSensitivity("budget.perPurchase", "public");
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(prefs).connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]!.text, isError: Boolean(r.isError) };
  };
  return { client, call };
}

describe("foxprefs MCP server", () => {
  it("M2 has three read-only tools and no write tool", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).toSorted()).toEqual(["prefs_get", "prefs_list_fields", "prefs_prompt"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("M1 gives public values, a grant notice for ask fields, and never a private value", async () => {
    const { call } = await connect();
    const r = await call("prefs_get", { fields: ["shopping.size.top", "food.allergies", "travel.loyalty", "food.diet", "pets.kind"] });
    expect(JSON.parse(r.text)).toEqual({
      "shopping.size.top": { status: "ok", value: "M" },
      "food.allergies": { status: "needs-grant", message: "needs a grant: ask the user through foxscope (SCENT) for this field" },
      "travel.loyalty": { status: "private", message: "private: the user never shares this field" },
      "food.diet": { status: "not-set" },
      "pets.kind": { status: "unknown-field" },
    });
    expect(r.text).not.toMatch(/peanuts|Aeroplan/);
    expect(JSON.parse((await call("prefs_get", { fields: ["budget.perPurchase"], derive: true })).text)).toEqual({ "budget.perPurchase": { status: "ok", value: "low" } });
  });

  it("lists fields without values, and gives the prompt text", async () => {
    const { call } = await connect();
    const list = await call("prefs_list_fields");
    expect(JSON.parse(list.text)).toContainEqual({ name: "travel.loyalty", label: "Loyalty numbers", sensitivity: "private", derivable: false });
    expect(list.text).not.toContain("Aeroplan");
    const prompt = await call("prefs_prompt");
    expect(prompt.text).toContain("- Top size: M");
    expect(prompt.text).not.toMatch(/peanuts|Aeroplan/);
    expect(await call("prefs_prompt", { fields: ["shopping.size.hat"] })).toEqual({ text: 'foxprefs: "shopping.size.hat" is not a preference field.', isError: true });
  });
});
