import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/.next/**", "**/target/**", "**/generated/**"],
  },
  {
    // Plain Node scripts/configs (e.g. codegen scripts, this file itself) run
    // under Node, not the browser — without these globals, `no-undef` (from
    // `js.configs.recommended`) flags legitimate references to `console`,
    // `process`, etc. as undefined.
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
);
