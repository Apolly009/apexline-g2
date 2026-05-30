import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const root = process.cwd();
const uploadRoot = resolve(root, "release-assets/evenhub-upload");
const currentDir = join(uploadRoot, "current");

const packageGroups = [
  {
    name: "ApexLine public",
    sourceDir: resolve(root, "release-assets/evenhub-packages"),
    targetDir: join(uploadRoot, "apexline-public"),
    match: /^apexline-main-public-.+\.ehpk$/
  },
  {
    name: "ApexLine experimental",
    sourceDir: resolve(root, "../ApexLineWorktrees/apexline-experimental/release-assets/evenhub-packages"),
    targetDir: join(uploadRoot, "apexline-experimental"),
    match: /^apexline-main-experimental-.+\.ehpk$/
  },
  {
    name: "ApexBike",
    sourceDir: resolve(root, "../ApexLineWorktrees/apexbike/release-assets/evenhub-packages"),
    targetDir: join(uploadRoot, "apexbike"),
    match: /^apexbike-public-.+\.ehpk$/
  }
];

await mkdir(currentDir, { recursive: true });
await clearCurrentPackages();

for (const group of packageGroups) {
  await mkdir(group.targetDir, { recursive: true });
  const files = await matchingPackages(group.sourceDir, group.match);

  if (files.length === 0) {
    console.warn(`No ${group.name} packages found in ${group.sourceDir}`);
    continue;
  }

  for (const file of files) {
    await copyFile(file, join(group.targetDir, basename(file)));
  }

  const latest = files.at(-1);
  if (latest) {
    await copyFile(latest, join(currentDir, basename(latest)));
    console.log(`${group.name}: ${basename(latest)} copied to current/`);
  }
}

console.log(`\nEvenHub upload folder:\n${uploadRoot}`);

async function clearCurrentPackages() {
  const entries = await readdir(currentDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ehpk"))
      .map((entry) => rm(join(currentDir, entry.name)))
  );
}

async function matchingPackages(sourceDir, match) {
  try {
    const entries = await readdir(sourceDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && match.test(entry.name))
      .map((entry) => join(sourceDir, entry.name))
      .sort(comparePackagePaths);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function comparePackagePaths(a, b) {
  return compareVersions(versionFromName(a), versionFromName(b)) || basename(a).localeCompare(basename(b));
}

function versionFromName(path) {
  const match = basename(path).match(/(\d+\.\d+\.\d+)\.ehpk$/);
  return match?.[1] ?? "0.0.0";
}

function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
