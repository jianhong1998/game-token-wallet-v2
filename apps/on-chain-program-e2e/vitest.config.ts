import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Registry is a program-wide singleton PDA (seeds = [b"registry"]) that
    // every test file in this suite shares against the same localnet/surfpool
    // deployment. Vitest runs test files as separate parallel workers by
    // default, so without an explicit ordering hook, sibling files calling
    // create_game can race registry/initialize.test.ts's own
    // initialize_registry call — see tests/global-setup.ts for the fix.
    globalSetup: ["./tests/global-setup.ts"],
  },
});
