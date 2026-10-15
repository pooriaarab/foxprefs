// foxprefs/node: the file store that the CLI and the MCP server use.
// The file is $FOXPREFS_HOME/prefs.json, default ~/.foxprefs/prefs.json.
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { FoxprefsError } from "./errors.js";
import { createPrefs, MAX_IMPORT_BYTES, type Prefs } from "./prefs.js";
import type { Schema } from "./schema.js";
import type { PrefStore } from "./store.js";

/** The directory that holds prefs.json. */
export function prefsHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.FOXPREFS_HOME || join(homedir(), ".foxprefs");
}

/** The path of the store file. */
export const prefsPath = (env: NodeJS.ProcessEnv = process.env) => join(prefsHome(env), "prefs.json");

/**
 * A store in one JSON file. A write goes to a temp file first and then
 * replaces the old file, so a crash never leaves half a file. The directory
 * is 0700 and the file 0600. A file that is not JSON fails loudly; foxprefs
 * never writes over it.
 */
export function fileStore(path: string): PrefStore {
  return {
    async read() {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      if (text.length > MAX_IMPORT_BYTES * 4) throw new FoxprefsError("bad-store", `${path} is too large to be a foxprefs store.`);
      try {
        return JSON.parse(text);
      } catch {
        throw new FoxprefsError("bad-store", `${path} is not valid JSON. foxprefs did not change it. Fix it or move it away.`);
      }
    },
    async write(state) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await chmod(dirname(path), 0o700);
      const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, path);
    },
  };
}

/** createPrefs on the file store at $FOXPREFS_HOME/prefs.json. */
export function openPrefs(options: { env?: NodeJS.ProcessEnv; schema?: Schema } = {}): Prefs {
  return createPrefs({ store: fileStore(prefsPath(options.env)), schema: options.schema });
}
