import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { createFromRoot } from "codama";
import renderVisitor from "@codama/renderers-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const idlPath = join(
  __dirname,
  "..",
  "..",
  "..",
  "apps",
  "on-chain-program",
  "target",
  "idl",
  "game_token_wallet.json",
);

const anchorIdl = JSON.parse(readFileSync(idlPath, "utf-8"));
const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));
codama.accept(renderVisitor(join(__dirname, "..", "src", "generated")));

console.log(`Generated on-chain-client from ${idlPath}`);
