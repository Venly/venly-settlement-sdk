import fs from "fs";

const target = "ui/scripts/build-registry.mjs";
let content = fs.readFileSync(target, "utf8");

// 3a: Insert AGENTS item before `const MONEY = {`
const agentsItem = `const AGENTS = {
  $schema: SCHEMA_ITEM,
  name: "agents",
  type: "registry:item",
  title: "Agent composition rules",
  description:
     "The rules a coding agent must follow when assembling a money product on this kit: hooks over hand-rolled calls, stage-then-confirm, no clientSecret in the browser, render the rule not the error. Installs at your repo root so it sits beside the code being written.",
  files: [file("AGENTS.md", "registry:file", "~/AGENTS.md")],
};

`;

content = content.replace("const MONEY = {", agentsItem + "const MONEY = {");

// 3b: Update items array
content = content.replace(
  "const items = [TOKENS, MONEY, ...COMPONENTS, ...BLOCKS];",
  "const items = [TOKENS, AGENTS, MONEY, ...COMPONENTS, ...BLOCKS];"
);

fs.writeFileSync(target, content);
console.log("Done. Verifying:");

const check = fs.readFileSync(target, "utf8");
console.log("Has AGENTS definition:", check.includes("const AGENTS = {"));
console.log("Has AGENTS in items:", check.includes("TOKENS, AGENTS, MONEY"));
console.log("Item count (should be 19):", check.includes("const items = [TOKENS, AGENTS"));
