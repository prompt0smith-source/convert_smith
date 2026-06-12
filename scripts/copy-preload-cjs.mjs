import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("src/preload/preload.cjs");
const target = path.resolve("dist-electron/preload/preload.cjs");
const packageTarget = path.resolve("dist-electron/package.json");

await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);
await writeFile(packageTarget, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
