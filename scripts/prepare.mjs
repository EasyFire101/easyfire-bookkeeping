import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.HUSKY !== "0" && process.env.CI !== "true") {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const huskyCli = resolve(root, "node_modules", "husky", "lib", "bin.js");

  execFileSync(process.execPath, [huskyCli, "install"], { stdio: "inherit" });
}
