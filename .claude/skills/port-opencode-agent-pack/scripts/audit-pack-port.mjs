#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "../../../..");
const requireFromDesktop = createRequire(path.join(repositoryRoot, "desktop/package.json"));
const { parse: parseYaml } = requireFromDesktop("yaml");

const TEXT_SUFFIXES = new Set([".md", ".markdown", ".mdx", ".txt"]);
const MENTION_RE = /(^|\s)@([A-Za-z0-9_./-]+\.(?:md|markdown|mdx|txt))(?=$|[\s).,;:!?\]])/gm;
const MAX_DEPTH = 5;
const MAX_BYTES = 100_000;
const SOURCE_RESIDUES = [
  [/(^|[/.])\.opencode([/\s]|$)|opencode\.json/gi, "OpenCode path/config remains"],
  [/\bTodoWrite\b/g, "OpenCode TodoWrite state remains"],
  [/<question-form\b/gi, "OpenCode question-form protocol remains"],
  [/\bGenUI\b|live[- ]artifact|daemon loop/gi, "OpenCode-only UI/daemon protocol may remain"],
];

const packArg = process.argv[2];
if (!packArg) {
  console.error("Usage: node audit-pack-port.mjs <pack-directory>");
  process.exit(2);
}

const packRoot = path.resolve(packArg);
const errors = [];
const warnings = [];
const checkedMentions = [];

function issue(bucket, file, message) {
  bucket.push(`${path.relative(packRoot, file) || "pack.yaml"}: ${message}`);
}

function readYaml(file) {
  try {
    return parseYaml(fs.readFileSync(file, "utf8"));
  } catch (error) {
    issue(errors, file, `cannot parse YAML (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function isInsidePack(file) {
  const rel = path.relative(packRoot, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function scanMentions(text, sourceFile, baseDir, state, depth = 0) {
  if (depth > MAX_DEPTH) {
    issue(errors, sourceFile, `inline mention nesting exceeds ${MAX_DEPTH} levels`);
    return;
  }

  for (const match of text.matchAll(MENTION_RE)) {
    const ref = match[2];
    const target = path.resolve(baseDir, ref);
    checkedMentions.push(`${path.relative(packRoot, sourceFile)} -> ${ref}`);

    if (ref.includes("\\") || path.isAbsolute(ref) || ref.split("/").includes("..")) {
      issue(errors, sourceFile, `unsafe/non-canonical inline mention @${ref}`);
      continue;
    }
    if (!TEXT_SUFFIXES.has(path.extname(ref).toLowerCase())) {
      issue(errors, sourceFile, `unsupported inline mention suffix @${ref}`);
      continue;
    }
    if (!isInsidePack(target)) {
      issue(errors, sourceFile, `inline mention escapes pack @${ref}`);
      continue;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      issue(errors, sourceFile, `inline mention does not resolve @${ref}`);
      continue;
    }

    let canonical;
    try {
      canonical = fs.realpathSync(target);
    } catch {
      canonical = target;
    }
    if (!isInsidePack(canonical)) {
      issue(errors, sourceFile, `inline mention symlink escapes pack @${ref}`);
      continue;
    }
    if (state.stack.has(canonical)) {
      issue(errors, sourceFile, `circular inline mention @${ref}`);
      continue;
    }

    const body = fs.readFileSync(canonical, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
    state.bytes += Buffer.byteLength(body, "utf8");
    if (state.bytes > MAX_BYTES) {
      issue(errors, sourceFile, `expanded inline content exceeds ${MAX_BYTES} bytes`);
    }
    state.stack.add(canonical);
    scanMentions(body, canonical, path.dirname(canonical), state, depth + 1);
    state.stack.delete(canonical);
  }
}

function collectFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

function rejectUnsupportedMentionContext(file, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(MENTION_RE)) {
    issue(
      errors,
      file,
      `${label} contains inert inline mention @${match[2]}; only agent prompt templates and their recursive includes are expanded`,
    );
  }
}

const manifestFile = path.join(packRoot, "pack.yaml");
if (!fs.existsSync(manifestFile)) {
  console.error(`ERROR ${manifestFile}: required pack.yaml is missing`);
  process.exit(1);
}

const manifest = readYaml(manifestFile);
const provides = manifest?.provides && typeof manifest.provides === "object" ? manifest.provides : {};
for (const [key, value] of Object.entries(provides)) {
  if (typeof value !== "string") continue;
  const target = path.resolve(packRoot, value);
  if (!isInsidePack(target) || !fs.existsSync(target)) {
    issue(errors, manifestFile, `provides.${key} does not resolve inside the pack (${value})`);
  }
}

const agentsDir = typeof provides.agents === "string" ? path.resolve(packRoot, provides.agents) : path.join(packRoot, "agents");
const agentFiles = fs.existsSync(agentsDir)
  ? fs.readdirSync(agentsDir).filter((name) => /\.ya?ml$/i.test(name)).map((name) => path.join(agentsDir, name))
  : [];
if (agentFiles.length === 0) issue(errors, manifestFile, "no agent YAML files found");

const agents = new Map();
for (const file of agentFiles) {
  const agent = readYaml(file);
  if (!agent || typeof agent.id !== "string") {
    issue(errors, file, "agent id is missing");
    continue;
  }
  if (agents.has(agent.id)) issue(errors, file, `duplicate agent id ${agent.id}`);
  agents.set(agent.id, { file, agent });
  if (path.basename(file).replace(/\.ya?ml$/i, "") !== agent.id) {
    issue(warnings, file, `filename does not match agent id ${agent.id}`);
  }
  const template = agent.prompt?.template;
  if (typeof template === "string") {
    scanMentions(template, file, packRoot, { bytes: 0, stack: new Set() });
    if (/`@[A-Za-z0-9_./-]+\.(?:md|markdown|mdx|txt)`/.test(template)) {
      issue(errors, file, "inline mention is wrapped in code and will not expand");
    }
  }
}

const skillsDir = typeof provides.skills === "string" ? path.resolve(packRoot, provides.skills) : path.join(packRoot, "skills");
const skillIds = new Set();
if (fs.existsSync(skillsDir)) {
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      issue(errors, skillFile, "skill directory has no SKILL.md");
      continue;
    }
    skillIds.add(entry.name);
    const raw = fs.readFileSync(skillFile, "utf8");
    const name = raw.match(/^---\r?\n[\s\S]*?^name:\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
    if (name !== entry.name) issue(errors, skillFile, `frontmatter name must match directory (${entry.name})`);
  }
}

for (const { file, agent } of agents.values()) {
  for (const target of agent.spawn?.canSpawn ?? []) {
    if (!agents.has(target)) issue(errors, file, `spawn.canSpawn references unknown agent ${target}`);
  }
  for (const skill of agent.skills ?? []) {
    if (!skill.includes("*") && !skillIds.has(skill)) issue(errors, file, `skills references unknown skill ${skill}`);
  }
}

const shepherd = manifest?.runtime?.shepherd;
if (shepherd) {
  for (const field of ["supervisorAgents", "workerAgents"]) {
    for (const agentId of shepherd[field] ?? []) {
      if (!agents.has(agentId)) issue(errors, manifestFile, `runtime.shepherd.${field} references unknown agent ${agentId}`);
    }
  }
  if (shepherd.enabled !== true || shepherd.settlement !== "explicit") {
    issue(errors, manifestFile, "Shepherd requires enabled: true and settlement: explicit");
  }
  if (["process-isolated", "coupled"].includes(shepherd.profile)) {
    issue(warnings, manifestFile, `${shepherd.profile} requires a proven installed backend; do not infer it from pack configuration`);
  }
  for (const agentId of [...(shepherd.supervisorAgents ?? []), ...(shepherd.workerAgents ?? [])]) {
    const configured = agents.get(agentId);
    if (configured?.agent?.tools?.includes("exec")) {
      issue(errors, configured.file, `Shepherd-managed agent ${agentId} grants generic exec instead of brokered structured effects`);
    }
  }
  if (manifest?.runtime?.context === undefined) {
    issue(warnings, manifestFile, "Shepherd-managed pack has no explicit runtime.context policy; verify that the default profile is intentional");
  }
}

const commandsDir = typeof provides.commands === "string" ? path.resolve(packRoot, provides.commands) : undefined;
if (commandsDir && fs.existsSync(commandsDir)) {
  for (const file of collectFiles(commandsDir).filter((name) => /\.md$/i.test(name))) {
    rejectUnsupportedMentionContext(file, "command body");
  }
}
if (typeof provides.workflow === "string") {
  rejectUnsupportedMentionContext(path.resolve(packRoot, provides.workflow), "workflow declaration");
}

for (const file of collectFiles(packRoot).filter((name) => /\.(?:md|markdown|mdx|txt|ya?ml|json)$/i.test(name))) {
  const text = fs.readFileSync(file, "utf8");
  for (const [pattern, message] of SOURCE_RESIDUES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) issue(warnings, file, message);
  }
}

for (const message of errors) console.error(`ERROR ${message}`);
for (const message of warnings) console.warn(`WARN  ${message}`);
console.log(`Checked ${agentFiles.length} agents, ${skillIds.size} skills, and ${checkedMentions.length} inline mentions.`);

if (errors.length > 0) {
  console.error(`Pack port audit failed with ${errors.length} error(s) and ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`Pack port audit passed with ${warnings.length} warning(s).`);
