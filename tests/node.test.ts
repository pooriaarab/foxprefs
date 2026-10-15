// N1-N3 and P1 (file) in docs/failure-modes.md.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileStore, openPrefs, prefsPath } from "../src/node.js";

const temp = () => mkdtempSync(join(tmpdir(), "foxprefs-test-"));

describe("foxprefs/node", () => {
  it("N1 the default path is ~/.foxprefs/prefs.json, and FOXPREFS_HOME moves it", () => {
    expect(prefsPath({})).toBe(join(homedir(), ".foxprefs", "prefs.json"));
    expect(prefsPath({ FOXPREFS_HOME: "/tmp/x" })).toBe("/tmp/x/prefs.json");
  });

  it("keeps values across processes, as a pretty JSON file", async () => {
    const env = { FOXPREFS_HOME: join(temp(), "home") };
    await openPrefs({ env }).set("food.diet", "vegan");
    expect(await openPrefs({ env }).get(["food.diet"])).toEqual({ "food.diet": "vegan" });
    expect(JSON.parse(readFileSync(prefsPath(env), "utf8")).values).toEqual({ "food.diet": "vegan" });
  });

  it("N2 writes through a temp file and leaves no temp file", async () => {
    const dir = temp();
    const prefs = openPrefs({ env: { FOXPREFS_HOME: dir } });
    await Promise.all([prefs.set("food.diet", "vegan"), prefs.set("travel.seat", "window")]);
    expect(readdirSync(dir)).toEqual(["prefs.json"]);
  });

  it("N3 the directory is 0700 and the file 0600", async () => {
    const dir = join(temp(), "home");
    await openPrefs({ env: { FOXPREFS_HOME: dir } }).set("food.diet", "vegan");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "prefs.json")).mode & 0o777).toBe(0o600);
  });

  it("N3 never changes the mode of a directory that exists", async () => {
    const dir = temp();
    chmodSync(dir, 0o755);
    await openPrefs({ env: { FOXPREFS_HOME: dir } }).set("food.diet", "vegan");
    expect(statSync(dir).mode & 0o777).toBe(0o755);
  });

  it("N2 a failed rename removes the temp file", async () => {
    const dir = temp();
    mkdirSync(join(dir, "prefs.json"));
    writeFileSync(join(dir, "prefs.json", "x"), "x");
    await expect(fileStore(join(dir, "prefs.json")).write({ format: "foxprefs/v1", values: {}, sensitivity: {}, updatedAt: "" })).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["prefs.json"]);
  });

  it("P1 a file that is not JSON fails loudly and is not changed", async () => {
    const dir = temp();
    writeFileSync(join(dir, "prefs.json"), "{ half a file");
    const prefs = openPrefs({ env: { FOXPREFS_HOME: dir } });
    await expect(prefs.set("food.diet", "vegan")).rejects.toThrow(/prefs\.json is not valid JSON\. foxprefs did not change it/);
    expect(readFileSync(join(dir, "prefs.json"), "utf8")).toBe("{ half a file");
  });

  it("a missing file reads as empty", async () => {
    expect(await fileStore(join(temp(), "none.json")).read()).toBeUndefined();
  });
});
