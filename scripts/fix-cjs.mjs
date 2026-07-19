// Stamp dist/cjs as CommonJS so require() works from a "type": "module" package.
import { writeFileSync } from "node:fs";
writeFileSync(new URL("../dist/cjs/package.json", import.meta.url), JSON.stringify({ type: "commonjs" }) + "\n");
