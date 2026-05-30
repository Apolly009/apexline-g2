import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const manifest = JSON.parse(readFileSync("app.json", "utf8"));
const networkPermission = manifest.permissions?.find((permission) => permission.name === "network");
const whitelist = networkPermission?.whitelist ?? [];
const files = [
  "app.json",
  "dist/index.html",
  ...safeReadDir("dist/assets").map((file) => `dist/assets/${file}`)
];
const urls = new Set();
const urlPattern = /https:\/\/[^\\"'\s)]+/g;

for (const file of files) {
  if (!existsSync(file) || statSync(file).isDirectory()) {
    continue;
  }

  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(urlPattern)) {
    urls.add(cleanUrl(match[0]));
  }
}

const uncovered = [...urls].filter((url) => !isCovered(url));

if (uncovered.length > 0) {
  console.error("Uncovered network URL(s):");
  for (const url of uncovered.sort()) {
    console.error(`- ${url}`);
  }
  process.exit(1);
}

console.log(`All ${urls.size} bundled network URL(s) are covered by app.json.`);

function safeReadDir(path) {
  return existsSync(path) ? readdirSync(path) : [];
}

function cleanUrl(url) {
  return url.replace(/[`.,;]+$/g, "");
}

function isCovered(url) {
  return whitelist.some((entry) => {
    if (url === entry) {
      return true;
    }
    return url.startsWith(`${entry}/`) || url.startsWith(`${entry}?`);
  });
}
