// The foxprefs command. runCli takes the arguments and the output streams,
// so tests run it in process. Exit codes: 0 done, 1 a foxprefs error, 2 bad usage.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { FoxprefsError } from "./errors.js";
import { openPrefs } from "./node.js";
import { formatValue } from "./values.js";

export const USAGE = `Usage: foxprefs <command>

  set <field> <value>        Set a preference, for example: set shopping.size.top M
  get <field...> [--derive]  Print values. --derive gives the smaller answer (budget band)
  list                       Print every field with its sensitivity and value
  unset <field>              Remove a value
  sensitivity <field> <public|ask|private>
  prompt [field...]          Print the text for an agent (public fields only)
  rules                      Print the hard limits as foxgate rules (JSON)
  export [--hcp]             Print the foxprefs/v1 record, or the HCP-style export
  import <file>              Replace every value with a foxprefs/v1 file

The store is $FOXPREFS_HOME/prefs.json (default ~/.foxprefs/prefs.json).
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env?: NodeJS.ProcessEnv;
}

class UsageError extends Error {}

const need = (args: string[], min: number, max = min) => {
  if (args.length < min || args.length > max) throw new UsageError("wrong number of arguments");
};

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { derive: { type: "boolean" }, hcp: { type: "boolean" }, help: { type: "boolean", short: "h" } } });
  } catch (error) {
    io.err(`foxprefs: ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const [command, ...args] = parsed.positionals;
  const flags = parsed.values;
  if (flags.help || command === "help" || !command) {
    (command || flags.help ? io.out : io.err)(USAGE);
    return command || flags.help ? 0 : 2;
  }
  const prefs = openPrefs({ env: io.env });
  const json = (v: unknown) => io.out(`${JSON.stringify(v, null, 2)}\n`);
  try {
    if ((flags.derive && command !== "get") || (flags.hcp && command !== "export")) throw new UsageError(`that flag does not apply to ${command}`);
    switch (command) {
      case "set": {
        if (args.length < 2) throw new UsageError("set needs a field and a value");
        await prefs.setText(args[0]!, args.slice(1).join(" "));
        const [info] = (await prefs.all()).filter((f) => f.name === args[0]);
        io.out(`${args[0]} = ${info?.text}\n`);
        return 0;
      }
      case "get": {
        if (args.length === 0) throw new UsageError("get needs one or more fields");
        const values = await prefs.get(args, { derive: flags.derive });
        for (const name of args) {
          const field = prefs.schema.find((f) => f.name === name)!;
          const text = !(name in values) ? "(not set)" : flags.derive && field.derive ? String(values[name]) : formatValue(field, values[name]);
          io.out(`${name}: ${text}\n`);
        }
        return 0;
      }
      case "list":
        need(args, 0);
        for (const f of await prefs.all()) io.out(`${f.name.padEnd(28)} ${f.sensitivity.padEnd(8)} ${f.text ?? "-"}\n`);
        return 0;
      case "unset":
        need(args, 1);
        await prefs.unset(args[0]!);
        io.out(`${args[0]} is not set now.\n`);
        return 0;
      case "sensitivity":
        need(args, 2);
        await prefs.setSensitivity(args[0]!, args[1] as never);
        io.out(`${args[0]} is ${args[1]} now.\n`);
        return 0;
      case "prompt":
        io.out(await prefs.toPrompt(args.length ? args : undefined));
        return 0;
      case "rules":
        need(args, 0);
        json(await prefs.toRules());
        return 0;
      case "export":
        need(args, 0);
        json(flags.hcp ? await prefs.toHcp() : await prefs.export());
        return 0;
      case "import": {
        need(args, 1);
        let text: string;
        try {
          text = await readFile(args[0]!, "utf8");
        } catch (error) {
          throw new FoxprefsError("bad-import", `Cannot read ${args[0]}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}.`);
        }
        await prefs.import(text);
        io.out(`Imported ${args[0]}.\n`);
        return 0;
      }
      default:
        throw new UsageError(`unknown command ${JSON.stringify(command)}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`foxprefs: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof FoxprefsError) {
      io.err(`foxprefs: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
