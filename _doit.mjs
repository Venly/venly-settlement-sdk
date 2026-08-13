import fs from "fs";
const f = ".github/workflows/ci.yml";
const c = fs.readFileSync(f, "utf8");
const lines = c.split("\n");

// Insert the AGENTS.md drift-check step after the provenance job's "fi"
// and before the sdk job.
const NEW_NAME = "       - name: AGENTS.md copies match the canonical root file";
const NEW_RUN = "        run: node scripts/sync-agents-md.mjs && git diff --exit-code";

// Find the sdk: line and insert before it
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === "sdk:" && i > 10) {
    const before = i - 1; // blank line before "sdk:"
    const newLines = [...lines.slice(0, before), NEW_NAME, NEW_RUN, "\n", ...lines.slice(before)];
    fs.writeFileSync(f, newLines.join("\n"));
    console.log("Written. Lines " + (before - 2) + " to " + (before + 5) + ":");
    for (let j = before - 2; j <= before + 5; j++) console.log(j + ": " + lines[j] + " -> " + newLines[j]);
    return;
  }
}
console.log("Not found");
