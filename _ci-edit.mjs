import fs from "fs";

const file = ".github/workflows/ci.yml";
const lines = fs.readFileSync(file, "utf8").split("\n");

// First, let's find key positions
let sdkLine = -1;
let provenanceFiLine = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === "sdk:") {
     sdkLine = i;
    break;
   }
}

if (sdkLine === -1) {
  console.log("ERROR: Could not find sdk: job");
  process.exit(1);
}

// Find the "fi" line right before "sdk:" job
// Provenance job ends with "fi" then blank line then "sdk:"
for (let i = sdkLine - 1; i >= 0; i--) {
  if (lines[i].trim() === "sdk:") {
    // Found it
    break;
  }
  if (lines[i].trim() === "fi" && i < sdkLine - 1) {
    provenanceFiLine = i;
     // The new step goes BEFORE the blank line, i.e. at sdkLine (which is before "sdk:")
    break;
    }
}

console.log(`sdk: at index ${sdkLine}`);
console.log(`provenance fi at: ${provenanceFiLine}`);

// Show context
console.log("\nContext:");
for (let i = Math.max(0, sdkLine - 4); i <= sdkLine + 3 && i < lines.length; i++) {
  console.log(`${i}: [${lines[i]}]`);
}

// The task says insert these two lines (with the four-line sequence including "fi" and blank line):
// The step should come BEFORE "sdk:" and after the blank line following "fi"
// Actually: task says "One exact edit - this four-line sequence occurs once":
//   exit 1
//   fi
// [BLANK LINE - where we insert before sdk:]
// sdk:

// Insert the new step at sdkLine (before sdk:)
// But there's a blank line between fi and sdk:

const newStepLines = [
   "       - name: AGENTS.md copies match the canonical root file",
   "         run: node scripts/sync-agents-md.mjs && git diff --exit-code",
];

const before = lines.slice(0, sdkLine);
const after = lines.slice(sdkLine);
const result = [...before, ...newStepLines, ...after];

fs.writeFileSync(file, result.join("\n"));

// Verify
console.log("\n--- Result ---");
for (let i = Math.max(0, sdkLine - 3); i <= sdkLine + 8 && i < result.length; i++) {
  console.log(`${i}: [${result[i]}]`);
}

console.log(`\nTotal lines: ${result.length}`);
