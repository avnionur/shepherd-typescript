#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPaths = [
  "package.json",
  "desktop/package.json",
  "desktop/app/package.json",
  ...safeDirs("packages").map((name) => `packages/${name}/package.json`),
].filter((file) => existsSync(path.join(root, file)));

const manifests = new Map(
  manifestPaths.map((file) => [file, JSON.parse(readFileSync(path.join(root, file), "utf8"))]),
);

const errors = [];
const warnings = [];
const infos = [];

function safeDirs(dir) {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function deps(manifest) {
  return {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
}

function dep(file, name) {
  const manifest = manifests.get(file);
  return manifest ? deps(manifest)[name] : undefined;
}

function major(range) {
  if (!range) return undefined;
  const match = String(range).match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function exactVersion(range) {
  return typeof range === "string" && /^\d+\.\d+\.\d+/.test(range);
}

function sameRange(label, entries, level = "error") {
  const present = entries.filter((entry) => entry.version !== undefined);
  const versions = new Set(present.map((entry) => entry.version));
  if (versions.size <= 1) return;
  const message = `${label} versions differ: ${present.map((entry) => `${entry.name}@${entry.version} (${entry.file})`).join(", ")}`;
  (level === "warning" ? warnings : errors).push(message);
}

function requireWorkspaceDeps(file) {
  const manifest = manifests.get(file);
  if (!manifest) return;
  for (const [section, sectionDeps] of Object.entries({
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
    peerDependencies: manifest.peerDependencies,
    optionalDependencies: manifest.optionalDependencies,
  })) {
    for (const [name, version] of Object.entries(sectionDeps ?? {})) {
      if (name.startsWith("@cognia/") && version !== "workspace:*") {
        errors.push(`${file} ${section}.${name} should use workspace:* but is ${version}`);
      }
    }
  }
}

for (const file of manifestPaths) requireWorkspaceDeps(file);

sameRange("Pi agent package", [
  { file: "desktop/package.json", name: "@earendil-works/pi-agent-core", version: dep("desktop/package.json", "@earendil-works/pi-agent-core") },
  { file: "desktop/package.json", name: "@earendil-works/pi-ai", version: dep("desktop/package.json", "@earendil-works/pi-ai") },
]);

const electron = dep("desktop/package.json", "electron");
const electronBuilder = dep("desktop/package.json", "electron-builder");
const electronVite = dep("desktop/package.json", "electron-vite");
const electronRebuild = dep("desktop/package.json", "@electron/rebuild");
const nodeTypes = dep("desktop/package.json", "@types/node");

infos.push(`Electron stack: electron ${electron ?? "missing"}, electron-builder ${electronBuilder ?? "missing"}, electron-vite ${electronVite ?? "missing"}, @electron/rebuild ${electronRebuild ?? "missing"}`);

if (major(electron) === undefined) errors.push("desktop/package.json is missing electron");
if (major(electron) !== undefined && major(electron) < 36) warnings.push(`Electron ${electron} is below the documented Cognia baseline of 36+`);
if (major(nodeTypes) !== 22) warnings.push(`desktop/package.json @types/node is ${nodeTypes ?? "missing"}; Cognia guidance currently expects Node 22 typings`);
if (major(electron) !== undefined && major(electron) >= 40) warnings.push(`Electron ${electron} is a high-impact major; verify embedded Node/Chromium/V8 and native module rebuild compatibility`);
if (major(electron) !== undefined && major(electron) >= 41 && major(nodeTypes) !== undefined && major(nodeTypes) < 24) {
  warnings.push(`Electron ${electron} embeds a Node 24-era runtime; @types/node ${nodeTypes} should be intentionally reviewed against Electron release metadata`);
}

for (const [name, version] of Object.entries({
  "node-pty": dep("desktop/package.json", "node-pty"),
  sharp: dep("desktop/package.json", "sharp"),
  "typescript-language-server": dep("desktop/package.json", "typescript-language-server"),
})) {
  if (!version) warnings.push(`desktop/package.json is missing ${name}, which may affect packaged desktop runtime expectations`);
}

sameRange("React runtime", [
  { file: "package.json", name: "react-dom", version: dep("package.json", "react-dom") },
  { file: "desktop/app/package.json", name: "react", version: dep("desktop/app/package.json", "react") },
  { file: "desktop/app/package.json", name: "react-dom", version: dep("desktop/app/package.json", "react-dom") },
  { file: "packages/auth/package.json", name: "react peer", version: dep("packages/auth/package.json", "react") },
  { file: "packages/shared/package.json", name: "react peer", version: dep("packages/shared/package.json", "react") },
  { file: "packages/vscode-explorer/package.json", name: "react peer", version: dep("packages/vscode-explorer/package.json", "react") },
], "warning");

for (const entry of [
  ["desktop/app/package.json", "@types/react"],
  ["desktop/app/package.json", "@types/react-dom"],
  ["packages/auth/package.json", "@types/react"],
  ["packages/shared/package.json", "@types/react"],
  ["packages/vscode-explorer/package.json", "@types/react"],
]) {
  const version = dep(entry[0], entry[1]);
  if (version && major(version) !== 19) warnings.push(`${entry[0]} ${entry[1]} is ${version}; renderer baseline expects React 19 types`);
}

for (const file of manifestPaths) {
  const version = dep(file, "zustand");
  if (version && major(version) !== 5) warnings.push(`${file} zustand is ${version}; Cognia renderer/shared peers expect Zustand 5`);
}

sameRange("TypeScript", manifestPaths.map((file) => ({ file, name: "typescript", version: dep(file, "typescript") })).filter((entry) => entry.version), "warning");

const viteVersions = manifestPaths
  .map((file) => ({ file, name: "vite", version: dep(file, "vite") }))
  .filter((entry) => entry.version);
for (const entry of viteVersions) {
  if (major(entry.version) !== 6) warnings.push(`${entry.file} vite is ${entry.version}; renderer baseline expects Vite 6`);
}

const codingame = [];
for (const file of manifestPaths) {
  for (const [name, version] of Object.entries(deps(manifests.get(file)))) {
    if (name.startsWith("@codingame/monaco-vscode-")) codingame.push({ file, name, version });
  }
}
const codingameVersions = new Set(codingame.map((entry) => entry.version));
if (codingameVersions.size > 1) {
  errors.push(`@codingame/monaco-vscode-* versions differ: ${codingame.map((entry) => `${entry.name}@${entry.version} (${entry.file})`).join(", ")}`);
}
for (const entry of codingame) {
  if (!exactVersion(entry.version)) errors.push(`${entry.file} ${entry.name} should be exact-pinned but is ${entry.version}`);
}

const monacoEditor = dep("desktop/app/package.json", "monaco-editor");
const vscodeExplorerMonacoEditor = dep("packages/vscode-explorer/package.json", "monaco-editor");
sameRange("monaco-editor", [
  { file: "desktop/app/package.json", name: "monaco-editor", version: monacoEditor },
  { file: "packages/vscode-explorer/package.json", name: "monaco-editor", version: vscodeExplorerMonacoEditor },
], "warning");

const rootManifest = manifests.get("package.json");
if (!rootManifest?.packageManager?.startsWith("pnpm@")) {
  errors.push(`package.json packageManager should pin pnpm but is ${rootManifest?.packageManager ?? "missing"}`);
}

const releaseConfig = path.join(root, "release-config.yaml");
if (existsSync(releaseConfig)) {
  const releaseText = readFileSync(releaseConfig, "utf8");
  const releaseVersion = releaseText.match(/\ncognia:\n\s+version:\s+([^\n]+)/)?.[1]?.trim();
  const desktopVersion = manifests.get("desktop/package.json")?.version;
  if (releaseVersion && desktopVersion && releaseVersion !== desktopVersion) {
    errors.push(`release-config.yaml cognia.version ${releaseVersion} does not match desktop/package.json version ${desktopVersion}`);
  }
}

console.log("Cognia dependency audit");
console.log("=======================");
for (const info of infos) console.log(`INFO  ${info}`);
for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const error of errors) console.log(`ERROR ${error}`);
console.log("");
console.log(`Scanned ${manifestPaths.length} source manifests.`);
console.log(`Result: ${errors.length} error(s), ${warnings.length} warning(s).`);

process.exitCode = errors.length > 0 ? 1 : 0;
