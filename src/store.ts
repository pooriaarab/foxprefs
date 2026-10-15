// Where the preferences live. A store reads and writes one JSON record;
// createPrefs checks the record, so a store needs no logic of its own.

/** The stored record, which is also the export format. */
export interface PrefsState {
  format: "foxprefs/v1";
  /** Field name to value. Only fields with a value are here. */
  values: Record<string, unknown>;
  /** Field name to the sensitivity the user chose, where it differs from the schema. */
  sensitivity: Record<string, string>;
  updatedAt: string;
}

export interface PrefStore {
  /** The stored record as plain JSON data, or undefined when there is none yet. */
  read(): Promise<unknown>;
  write(state: PrefsState): Promise<void>;
}

/** A store in memory, for tests and short-lived agents. */
export function memoryStore(initial?: PrefsState): PrefStore {
  let state: string | undefined = initial && JSON.stringify(initial);
  return {
    read: async () => (state === undefined ? undefined : JSON.parse(state)),
    write: async (next) => {
      state = JSON.stringify(next);
    },
  };
}

/** The part of a WebExtension storage area that foxprefs uses. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** A store in a WebExtension storage area, for example `browser.storage.local`. */
export function storageAreaStore(area: StorageAreaLike, key = "foxprefs"): PrefStore {
  return {
    read: async () => (await area.get(key))[key],
    write: (state) => area.set({ [key]: state }),
  };
}
