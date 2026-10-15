// C1-C3 in docs/failure-modes.md, and each command once.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

function cli() {
  const env = { FOXPREFS_HOME: mkdtempSync(join(tmpdir(), "foxprefs-cli-")) };
  return async (...argv: string[]) => {
    let out = "";
    let err = "";
    const code = await runCli(argv, { out: (t) => void (out += t), err: (t) => void (err += t), env });
    return { code, out, err, env };
  };
}

describe("foxprefs CLI", () => {
  it("sets, gets, lists and unsets", async () => {
    const run = cli();
    expect(await run("set", "shopping.size.top", "M")).toMatchObject({ code: 0, out: "shopping.size.top = M\n" });
    expect((await run("set", "budget.perPurchase", "300", "USD")).out).toBe("budget.perPurchase = 300.00 USD\n");
    expect((await run("get", "shopping.size.top", "food.diet", "budget.perPurchase")).out).toBe("shopping.size.top: M\nfood.diet: (not set)\nbudget.perPurchase: 300.00 USD\n");
    expect((await run("get", "budget.perPurchase", "--derive")).out).toBe("budget.perPurchase: high\n");
    expect((await run("list")).out).toMatch(/^shopping\.size\.top +public +M$/m);
    expect((await run("unset", "shopping.size.top")).code).toBe(0);
    expect((await run("get", "shopping.size.top")).out).toBe("shopping.size.top: (not set)\n");
  });

  it("prints the prompt, the rules and both exports", async () => {
    const run = cli();
    await run("set", "food.diet", "vegan");
    await run("set", "travel.loyalty", "Aeroplan 123");
    await run("set", "rules.maxPurchase", "200 USD");
    const prompt = (await run("prompt")).out;
    expect(prompt).toContain("- Diet: vegan");
    expect(prompt).not.toContain("Aeroplan");
    expect(JSON.parse((await run("rules")).out).maxPerPurchase).toEqual({ value: 20000, currency: "USD" });
    expect(JSON.parse((await run("export")).out).format).toBe("foxprefs/v1");
    expect(JSON.parse((await run("export", "--hcp")).out).format).toBe("foxprefs/hcp-v0");
    expect((await run("sensitivity", "food.diet", "private")).out).toBe("food.diet is private now.\n");
    expect((await run("prompt")).out).not.toContain("vegan");
  });

  it("imports a file", async () => {
    const a = cli();
    await a("set", "travel.seat", "aisle");
    const file = join(mkdtempSync(join(tmpdir(), "foxprefs-x-")), "prefs.json");
    writeFileSync(file, (await a("export")).out);
    const b = cli();
    expect((await b("import", file)).code).toBe(0);
    expect((await b("get", "travel.seat")).out).toBe("travel.seat: aisle\n");
  });

  it("C1 bad usage exits 2 with the usage", async () => {
    const run = cli();
    for (const argv of [[], ["fly"], ["get"], ["set", "food.diet"], ["list", "x"], ["get", "food.diet", "--color"], ["prompt", "--derive"]]) {
      const r = await run(...argv);
      expect([argv, r.code]).toEqual([argv, 2]);
      expect(r.err).toContain("Usage: foxprefs");
    }
    expect((await run("--help")).code).toBe(0);
  });

  it("C2 a bad value exits 1 and changes nothing", async () => {
    const run = cli();
    await run("set", "food.diet", "vegan");
    expect(await run("set", "food.diet", "carnivore")).toMatchObject({ code: 1, err: expect.stringMatching(/^foxprefs: food\.diet: must be one of/) });
    expect(await run("set", "rules.maxPurchase", "200")).toMatchObject({ code: 1, err: expect.stringContaining("not an amount with a currency") });
    expect(await run("get", "shoping.size")).toMatchObject({ code: 1, err: expect.stringContaining("is not a preference field") });
    expect((await run("get", "food.diet")).out).toBe("food.diet: vegan\n");
  });

  it("C3 import of a missing file exits 1 and names it", async () => {
    expect(await cli()("import", "/no/such/prefs.json")).toMatchObject({ code: 1, err: "foxprefs: Cannot read /no/such/prefs.json: ENOENT.\n" });
  });
});
