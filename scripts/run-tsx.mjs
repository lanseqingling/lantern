import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, RUST_LOG: process.env.RUST_LOG || "info" },
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
