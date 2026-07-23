import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Avoid `new URL("./globals.css", import.meta.url)` here: under the jsdom test
// environment the global URL constructor resolves relative refs against
// `location` (http://localhost:3000/) rather than the file:// base, so we
// resolve the path manually instead.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(currentDir, "globals.css"), "utf-8");

describe("globals.css design tokens", () => {
  it.each(["--radius-sm", "--radius-md", "--radius-lg", "--radius-xl"])(
    "declares %s exactly once (no shadowing collision)",
    (token) => {
      const matches = css.match(new RegExp(`^\\s*${token}:`, "gm")) ?? [];
      expect(matches).toHaveLength(1);
    },
  );
});
