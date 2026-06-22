import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function moduleEntry(specifier) {
  return require.resolve(specifier);
}

function run(command, args) {
  const display = [path.basename(command), ...args].join(" ");
  console.log(`\n> ${display}`);

  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function buildRenderer() {
  console.log("\n> vite build");

  const { build } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;

  await build({
    base: "./",
    configFile: false,
    plugins: [react()],
    root: rootDir,
    build: {
      emptyOutDir: true,
      outDir: "dist",
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  });
}

run(process.execPath, [moduleEntry("typescript/bin/tsc"), "-b"]);
await buildRenderer();
run(process.execPath, [moduleEntry("typescript/bin/tsc"), "-p", "tsconfig.electron.json"]);
run(process.execPath, ["scripts/copy-preload-cjs.mjs"]);
run(process.execPath, [moduleEntry("electron-builder/cli.js")]);
