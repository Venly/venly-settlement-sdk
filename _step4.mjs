import fs from "fs";

const f = ".github/workflows/ci.yml";
let c = fs.readFileSync(f, "utf8");

const old = "          fi\n\n  sdk:";
const nw = "          fi\n         - name: AGENTS.md copies match the canonical root file\n        run: node scripts/sync-agents-md.mjs && git diff --exit-code\n\n  sdk:";

if (!c.includes(old)) {
  console.log("Pattern not found!");
  process.exit(1);
}

c = c.replace(old, nw);
fs.writeFileSync(f, c);

console.log("Written successfully");
const L = c.split("\n");
for (var i = 25; i <= 35; i++) {
  console.log(i + ": " + JSON.stringify(L[i]));
}
