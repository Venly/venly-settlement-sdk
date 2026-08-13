import fs from "fs";

const pkgPath = "settlement-mcp/package.json";
let lines = fs.readFileSync(pkgPath, "utf8").split("\n");

// Find the first README.md line (the one from the first fix attempt) and remove it
// Also need to verify AGENTS.md and README.md are both present (possibly duplicated)
while (lines.length > 0) {
  idx = lines.findIndex(l => l.includes('"README.md"'));
   if (idx === -1) break;
  // Keep adding README.md, but first check if AGENTS.md exists
  if (!lines.some(l => l.includes('"AGENTS.md"'))) {
    // No AGENTS.md line, add the correct list
    break;
   }
  lines.splice(idx, 1);
  console.log(`Removed duplicate at line ${idx + 1}`);
}

// Now ensure the order is correct
const agentIdx = lines.findIndex(l => l.includes('"AGENTS.md"'));
const readmeIdx = lines.findIndex(l => l.includes('"README.md"'));
const changelogIdx = lines.findIndex(l => l.includes('"CHANGELOG.md"'));
console.log(`After dedup: AGENTS@${agentIdx}, README@${readmeIdx}, CHANGELOG@${changelogIdx}`);

// The file needs: dist, scripts, skills, AGENTS.md, README.md, CHANGELOG.md
// Check order
if (agentIdx > readmeIdx) {
  // Swap them
  [lines[agentIdx], lines[readmeIdx]] = [lines[readmeIdx], lines[agentIdx]];
  console.log("Swapped AGENTS and README order");
}

fs.writeFileSync(pkgPath, lines.join("\n"));
console.log("Fixed file.");
