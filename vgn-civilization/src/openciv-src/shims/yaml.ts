// Replacement for the npm `yaml` package: our `fs` shim already returns JSON strings.
export default {
  parse(str: string): any {
    return JSON.parse(str);
  },
};

