import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, relative, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

function parseArgs(argv) {
  let sourceRoot = null;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source-root") {
      if (i + 1 >= args.length) {
        console.error("Error: --source-root requires a path argument.");
        process.exit(2);
      }
      sourceRoot = args[i + 1];
      i++;
    } else if (args[i].startsWith("-")) {
      console.error(`Error: Unknown option "${args[i]}".`);
      process.exit(2);
    } else {
      console.error(`Error: Unexpected argument "${args[i]}".`);
      process.exit(2);
    }
  }
  return sourceRoot;
}

const customRoot = parseArgs(process.argv);
const SRC_ROOT = customRoot
  ? resolve(customRoot)
  : join(REPO_ROOT, "packages", "server", "src");

if (!existsSync(SRC_ROOT)) {
  console.error(`Error: Source root does not exist: ${SRC_ROOT}`);
  process.exit(2);
}

const EXTENSIONS = [".ts", ".js", ".tsx", ".jsx"];

function* walkSourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkSourceFiles(full);
    } else if (/\.(ts|js)x?$/i.test(e.name) && !e.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const SPEC_RE =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](\.\.?\/[^'"]+)['"]/g;

function extractSpecifiers(content) {
  const activeCode = stripComments(content);
  const results = [];
  let m;
  while ((m = SPEC_RE.exec(activeCode)) !== null) {
    results.push(m[1]);
  }
  return results;
}

function resolveSpecifier(fileDir, spec) {
  const expected = resolve(fileDir, spec);
  for (const ext of EXTENSIONS) {
    if (existsSync(expected + ext)) return expected + ext;
  }
  for (const ext of EXTENSIONS) {
    const ip = join(expected, "index" + ext);
    if (existsSync(ip)) return ip;
  }
  if (existsSync(expected)) return expected;
  return null;
}

function checkPathSegments(resolvedAbs) {
  const relPath = relative(SRC_ROOT, resolvedAbs);
  if (relPath.startsWith("..")) return [];
  const segments = relPath.split(sep);
  const mismatches = [];
  let built = SRC_ROOT;
  for (let i = 0; i < segments.length; i++) {
    const expected = segments[i];
    let entries;
    try {
      entries = readdirSync(built, { withFileTypes: true });
    } catch {
      return mismatches;
    }
    const lower = expected.toLowerCase();
    const actual = entries.find((e) => e.name.toLowerCase() === lower);
    if (!actual) {
      return mismatches;
    }
    if (actual.name !== expected) {
      mismatches.push({ expected, actual: actual.name });
      built = join(built, actual.name);
    } else {
      built = join(built, expected);
    }
  }
  return mismatches;
}

const allMismatches = [];
for (const file of walkSourceFiles(SRC_ROOT)) {
  let content;
  try {
    content = readFileSync(file, "utf-8");
  } catch {
    continue;
  }
  const specifiers = extractSpecifiers(content);
  if (!specifiers.length) continue;
  const fileDir = dirname(file);
  for (const spec of specifiers) {
    const resolved = resolveSpecifier(fileDir, spec);
    if (!resolved) continue;
    const mismatches = checkPathSegments(resolved);
    for (const mm of mismatches) {
      allMismatches.push({
        file: relative(REPO_ROOT, file),
        specifier: spec,
        ...mm,
      });
    }
  }
}

if (allMismatches.length > 0) {
  const fileMap = new Map();
  for (const m of allMismatches) {
    const key = m.file;
    if (!fileMap.has(key)) fileMap.set(key, []);
    fileMap.get(key).push(m);
  }
  for (const [file, items] of fileMap) {
    console.log(`\n${file}:`);
    for (const item of items) {
      console.log(`  "${item.specifier}"`);
      console.log(`    expected: "${item.expected}"  actual: "${item.actual}"`);
    }
  }
  console.log(`\n${allMismatches.length} case mismatch(es) found.\n`);
  process.exit(1);
}

console.log(`\nNo relative-import case mismatches detected.\n`);
process.exit(0);
