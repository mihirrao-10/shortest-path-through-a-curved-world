import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "web/dist");
if (!existsSync(root)) throw new Error(`Build directory does not exist: ${root}`);

const files = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
}
walk(root);

const failures = [];
const base = "/shortest-path-through-a-curved-world/";
for (const file of files.filter((path) => extname(path) === ".html")) {
  const html = readFileSync(file, "utf8");
  const attributes = [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map((match) => match[1]);
  for (const value of attributes) {
    if (!value || value.startsWith("#") || value.startsWith("mailto:")) continue;
    if (/^https?:\/\//.test(value)) {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") failures.push(`${relative(root, file)}: external URL is not HTTPS: ${value}`);
      } catch {
        failures.push(`${relative(root, file)}: malformed URL: ${value}`);
      }
      continue;
    }
    const withoutQuery = value.split(/[?#]/, 1)[0];
    const deployRelative = withoutQuery.startsWith(base) ? withoutQuery.slice(base.length) : withoutQuery;
    const target = resolve(withoutQuery.startsWith("/") ? root : resolve(file, ".."), deployRelative);
    const candidates = [target, join(target, "index.html")];
    if (!candidates.some((candidate) => existsSync(candidate))) {
      failures.push(`${relative(root, file)}: missing local target ${value}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} built files and all HTML links.`);
}
