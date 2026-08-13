import fs from "fs";

const pkgPath = "settlement-mcp/package.json";
const lines = fs.readFileSync(pkgPath, "utf8").split("\n");

// Find README.md line and insert AGENTS.md right before it
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('"README.md"') && lines[i].includes('"skills"') === false) {
    const prefix = /^(\s*)/.exec(lines[i])[1];
    lines.splice(i, 0, prefix + '"AGENTS.md",');
    console.log(`Inserted AGENTS.md at line ${i} with prefix [${prefix}]`);
    break;
    }
}

fs.writeFileSync(pkgPath, lines.join("\n"));

// Verify
const check = fs.readFileSync(pkgPath, "utf8").split("\n");
for (let i = 0; i < check.length; i++) {
  if (check[i].match(/\.md["]/)) console.log(`${i}: ${check[i]}`);
}
console.log("Done.");
