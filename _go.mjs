import fs from "fs";

const f = ".github/workflows/ci.yml";
const lines = fs.readFileSync(f, "utf8").split("\n");

// Find the blank Line 28 (index 27) between "fi" and "sdk:"
let insertIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (i > 0 && lines[i].trim() === "sdk:" && lines[i - 1] === "") {
    insertIdx = i;
    break;
     }
}

const NEW = [
   "      - name: AGENTS.md copies match the canonical root file",
    "       run: node scripts/sync-agents-md.mjs && git diff --exit-code",
];

const before = lines.slice(0, insertIdx);
const after = lines.slice(insertIdx);
const result = before.concat(NEW).concat(after);
fs.writeFileSync(f, result.join("\n"));

console.log("Done. Lines " + (insertIdx - 2) + " to " + (insertIdx + 7) + ":");
result.forEach((l, i) => {
  if (i >= insertIdx - 2 && i <= insertIdx + 7) console.log(i + ": [" + l + "]");
});
