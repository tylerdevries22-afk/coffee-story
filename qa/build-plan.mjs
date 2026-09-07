#!/usr/bin/env node
// Rebuilds plan.html from the durable sources. Every value on the page is read
// here; the renderer authors no content of its own, so re-running this after any
// task or cycle update reproduces the artifact exactly.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./lib/yaml-mini.mjs";
import { renderPlan } from "./lib/plan-render.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (relative) => path.join(root, relative);
const read = (relative) => readFileSync(at(relative), "utf8");

const SOURCES = ["qa/tasks.yaml", "qa/task-ledger.json", ".adaptive-context/ledger.json", "OWNER-ACTIONS.md"];

function commits(limit = 8) {
  const out = execFileSync("git", ["log", `-${limit}`, "--format=%h\t%ad\t%s", "--date=short"], {
    cwd: root, encoding: "utf8",
  });
  return out.split("\n").filter(Boolean).map((line) => {
    // A subject may itself contain a tab, so only the first two fields are split off.
    const [sha, date, ...rest] = line.split("\t");
    return { sha, date, subject: rest.join("\t") };
  });
}

function ownerActionHeadings(markdown) {
  // Only the section headings travel into the artifact: the bodies carry job ids,
  // machine ids and absolute paths that are private operational detail.
  return markdown.split("\n")
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, "").trim());
}

function main() {
  const tasksDoc = parseYaml(read("qa/tasks.yaml"));
  const ledger = JSON.parse(read("qa/task-ledger.json"));
  const recovery = JSON.parse(read(".adaptive-context/ledger.json"));
  const html = renderPlan({
    goal: tasksDoc.goal,
    tasks: tasksDoc.tasks,
    ledger,
    recovery,
    ownerActions: ownerActionHeadings(read("OWNER-ACTIONS.md")),
    commits: commits(),
    generatedAt: `${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`,
    sources: SOURCES,
  });
  writeFileSync(at("plan.html"), html, "utf8");
  process.stdout.write(`plan.html ${html.length} bytes; ${tasksDoc.tasks.length} tasks; ${ledger.cycles.length} cycles\n`);
}

main();
