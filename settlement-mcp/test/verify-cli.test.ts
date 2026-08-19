import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeHarness } from "./helpers.ts";

const mcpRoot = fileURLToPath(new URL("..", import.meta.url));

function project(
  dependencies: Record<string, string>,
  files: Record<string, string>,
): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "venly-verify-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ private: true, dependencies }, null, 2),
  );
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    writeFileSync(target, source);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runVerify(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      join(mcpRoot, "node_modules/tsx/dist/loader.mjs"),
      join(mcpRoot, "src/index.ts"),
      "verify",
      ...args,
    ],
    { cwd: root, encoding: "utf8", timeout: 10_000 },
  );
}

const DIRECT_GOOD = `
import { VenlyProvider, useAccounts } from "@venlyfinance/react";
export function App() {
  useAccounts();
  return <VenlyProvider environment="mock"><main /></VenlyProvider>;
}`;

test("verify CLI: exit 2 with usage on no arguments", () => {
  const result = runVerify(mcpRoot, []);
  assert.equal(result.status, 2, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /Usage: verify/);
});

test("verify CLI: direct-sdk profile passes a package-backed provider and hook", () => {
  const p = project(
    { "@venlyfinance/react": "^0.4.0", "@venlyfinance/sdk": "^0.5.0" },
    { "src/App.tsx": DIRECT_GOOD },
  );
  try {
    const result = runVerify(p.root, ["src/**/*.{ts,tsx}"]);
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /profile: direct-sdk/);
    assert.match(result.stdout, /0 error\(s\), 0 warning\(s\)/);
  } finally {
    p.cleanup();
  }
});

test("verify CLI: zero Venly packages is an error; missing react remains a warning", () => {
  const p = project({}, { "src/App.tsx": "export const App = () => <main />;" });
  try {
    const result = runVerify(p.root, ["--profile", "direct-sdk", "src/**/*.tsx"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /error  venly-package-missing/);
    assert.match(result.stdout, /warn  react-package-missing/);
  } finally {
    p.cleanup();
  }
});

test("verify CLI: direct-sdk requires the provider and a blueprint hook import", () => {
  const p = project(
    { "@venlyfinance/react": "^0.4.0" },
    { "src/App.tsx": 'import { VenlyProvider } from "@venlyfinance/react"; export const App = () => <main />;' },
  );
  try {
    const result = runVerify(p.root, ["src/**/*.tsx"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /error  provider-missing/);
    assert.match(result.stdout, /error  blueprint-hook-missing/);
  } finally {
    p.cleanup();
  }
});

test("verify CLI: browser clientSecret is an error and the standard hatch suppresses it", () => {
  const p = project(
    { "@venlyfinance/react": "^0.4.0" },
    {
      "src/App.tsx": `${DIRECT_GOOD}\nconst clientSecret = "nope";`,
      "src/Suppressed.tsx": `${DIRECT_GOOD}\n// venly-allow:browser-client-secret\nconst clientSecret = "documented exception";`,
    },
  );
  try {
    const result = runVerify(p.root, ["src/App.tsx"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /error  browser-client-secret/);

    const suppressed = runVerify(p.root, ["src/Suppressed.tsx"]);
    assert.equal(suppressed.status, 0, suppressed.stdout);
    assert.doesNotMatch(suppressed.stdout, /browser-client-secret/);
  } finally {
    p.cleanup();
  }
});

test("verify CLI: backend profile auto-detects; ambiguous money routes and stores warn", () => {
  const p = project(
    { "@venlyfinance/sdk": "^0.5.0", "@venlyfinance/react": "^0.4.0" },
    {
      "src/client.tsx": 'import { proxyClientOptions } from "@venlyfinance/react"; export const options = proxyClientOptions("/api");',
      "src/app/api/transfers/route.ts": "export async function POST() { return Response.json({}); }",
      "src/store.ts": "export const transfers = [];",
    },
  );
  try {
    const result = runVerify(p.root, ["src/**/*.{ts,tsx}"]);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /profile: backend-proxy/);
    assert.match(result.stdout, /warn  money-route-without-sdk/);
    assert.match(result.stdout, /warn  in-memory-money-store/);
  } finally {
    p.cleanup();
  }
});

test("verify CLI: backend profile requires sdk and rejects clientSecret outside server files", () => {
  const p = project(
    { "@venlyfinance/react": "^0.4.0" },
    {
      "src/client.tsx": 'import { proxyClientOptions } from "@venlyfinance/react"; const clientSecret = "leak"; export const options = proxyClientOptions("/api");',
    },
  );
  try {
    const result = runVerify(p.root, ["src/**/*.tsx"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /error  sdk-package-missing/);
    assert.match(result.stdout, /error  client-secret-outside-server/);
  } finally {
    p.cleanup();
  }
});

test("verify CLI: polling status in transfer UI is a suppressible warning", () => {
  const p = project(
    { "@venlyfinance/react": "^0.4.0" },
    {
      "src/App.tsx": `${DIRECT_GOOD}\nuseEffect(() => { const timer = setInterval(() => refetchTransferStatus(), 1000); return () => clearInterval(timer); }, [transferState]);`,
    },
  );
  try {
    const result = runVerify(p.root, ["src/**/*.tsx"]);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /warn  status-polling/);
  } finally {
    p.cleanup();
  }
});

test("verify CLI: exit 2 when a pattern matches nothing", () => {
  const p = project({}, { "src/App.tsx": DIRECT_GOOD });
  try {
    const result = runVerify(p.root, ["src/**/*.nope"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Nothing matched/);
  } finally {
    p.cleanup();
  }
});

test("verify CLI: nested monorepo sources use the nearest package.json", () => {
  const root = mkdtempSync(join(tmpdir(), "venly-verify-monorepo-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true }));
    mkdirSync(join(root, "apps/web/src/features"), { recursive: true });
    writeFileSync(
      join(root, "apps/web/package.json"),
      JSON.stringify({ dependencies: { "@venlyfinance/react": "^0.4.0" } }),
    );
    writeFileSync(join(root, "apps/web/src/features/App.tsx"), DIRECT_GOOD);

    const result = runVerify(root, ["apps/web/src/**/*.tsx"]);
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /0 error\(s\), 0 warning\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify_runtime_contract MCP tool is registered and returns structured findings", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  try {
    const tools = await h.client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "verify_runtime_contract"));
    const result: any = await h.client.callTool({
      name: "verify_runtime_contract",
      arguments: {
        profile: "direct-sdk",
        packageJson: JSON.stringify({ dependencies: { "@venlyfinance/react": "^0.4.0" } }),
        files: [{ path: "src/App.tsx", source: DIRECT_GOOD }],
      },
    });
    assert.equal(result.structuredContent.profile, "direct-sdk");
    assert.deepEqual(result.structuredContent.findings, []);
  } finally {
    await h.close();
  }
});
