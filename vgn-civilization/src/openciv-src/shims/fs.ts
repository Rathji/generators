import { CONFIG_FILES } from "./config-data";

// Replacement for node's `fs` module. Only the config .yml reads are used by OpenCiv,
// and the configs are inlined as JSON in config-data.ts.
export default {
  readFileSync(path: string): string {
    const key = String(path).split("/").pop();
    if (key && CONFIG_FILES[key]) return CONFIG_FILES[key];
    throw new Error("fs shim: unknown file: " + path);
  },
};

