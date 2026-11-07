import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const site = resolve(root, "apps/web/out/index.html");

function run(args) {
  const result = spawnSync("pnpm", args, { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Cloudflare builds only this package, so the site has to be created here.
// The full workspace build already creates it, and a second next build fails.
if (!existsSync(site)) run(["--filter", "@veriq/web", "build"]);
run(["--filter", "@veriq/api", "exec", "wrangler", "deploy", "--dry-run", "--outdir", "dist"]);
