import fs from "fs";

const target = ".github/workflows/ci.yml";
let lines = fs.readFileSync(target, "utf8").split("\n");

// Show lines 26-32 (0-indexed: 25-31)
for (let i = 25; i <= 32; i++) {
  console.log(`${i+1}: |${"\t".repeat((lines[i].match(/^\t*/)||[""])[0].length)}> ${lines[i]}`);
  console.log(`${i+1}: [${lines[i]}]`);
}
