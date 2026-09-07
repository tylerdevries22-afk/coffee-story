// Renders the durable task state as a self-contained progress page. Every value
// on the page comes from the sources passed in; nothing is authored here.
const STATUS_ORDER = ["done", "in_progress", "pending", "blocked"];

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const list = (items, render) => (items ?? []).map(render).join("");

function counts(tasks) {
  const tally = new Map(STATUS_ORDER.map((status) => [status, 0]));
  for (const task of tasks) tally.set(task.status, (tally.get(task.status) ?? 0) + 1);
  return STATUS_ORDER.map((status) => ({ status, count: tally.get(status) ?? 0 }));
}

function taskRow(task) {
  const detail = [
    task.acceptance && `<div class="k">Acceptance</div><div>${esc(task.acceptance)}</div>`,
    task.evidence && `<div class="k">Evidence</div><div>${esc(task.evidence)}</div>`,
    task.blocked_by && `<div class="k">Blocked by</div><div>${esc(task.blocked_by)}</div>`,
    task.note && `<div class="k">Note</div><div>${esc(task.note)}</div>`,
  ].filter(Boolean).join("");
  return `<tr class="s-${esc(task.status)}">
    <td class="id">${esc(task.id)}</td>
    <td><div class="title">${esc(task.title)}</div><dl class="detail">${detail}</dl></td>
    <td><span class="pill p-${esc(task.status)}">${esc(task.status.replace("_", " "))}</span></td>
    <td class="owner">${esc(task.owner ?? "")}</td>
  </tr>`;
}

function cycle(entry) {
  const checks = list(entry.checks, (check) => `<li class="r-${esc(check.result)}">
    <span class="pill p-${esc(check.result)}">${esc(check.result)}</span>
    <strong>${esc(check.name)}</strong><span class="d">${esc(check.detail)}</span></li>`);
  const risks = entry.risks?.length
    ? `<div class="k">Remaining risks</div><ul class="plain">${list(entry.risks, (r) => `<li>${esc(r)}</li>`)}</ul>`
    : "";
  return `<article class="cycle">
    <h3>Cycle ${esc(entry.cycle)} <span class="tag">${esc(entry.taskId)}</span></h3>
    <p class="change">${esc(entry.change)}</p>
    <ul class="checks">${checks}</ul>${risks}
    <div class="k">Next</div><p>${esc(entry.next)}</p>
  </article>`;
}

const STYLE = `:root{color-scheme:dark;--bg:#0d0f12;--panel:#15181d;--line:#262b33;
--ink:#e8eaed;--dim:#9aa3af;--ok:#4ea672;--warn:#c9922f;--stop:#c05a52;--info:#5a86c0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font:14px/1.55 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:40px 24px 72px}
h1{font-size:22px;margin:0 0 6px}h2{font-size:15px;letter-spacing:.08em;text-transform:uppercase;
color:var(--dim);margin:40px 0 12px;font-weight:600}h3{font-size:14px;margin:0 0 6px}
.meta{color:var(--dim);font-size:12px;margin:0 0 24px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
.tally{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 8px;padding:0;list-style:none}
.tally li{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:12px}
.tally b{font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:640px}
th,td{text-align:left;vertical-align:top;padding:12px 10px;border-top:1px solid var(--line)}
th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);border-top:0}
.id{font-variant-numeric:tabular-nums;color:var(--dim)}.owner{color:var(--dim)}
.title{font-weight:600}dl.detail{margin:6px 0 0;display:grid;grid-template-columns:auto 1fr;gap:2px 12px}
.k{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--dim);margin-top:8px}
dl.detail .k{margin:0}dl.detail div{font-size:13px;color:var(--dim)}
.pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;border:1px solid currentColor}
.p-done,.p-pass{color:var(--ok)}.p-blocked,.p-fail{color:var(--stop)}
.p-pending{color:var(--dim)}.p-in_progress{color:var(--info)}
.cycle{border-left:2px solid var(--line);padding:0 0 0 16px;margin:0 0 22px}
.cycle .tag{color:var(--dim);font-weight:400}.change{margin:0 0 10px;color:var(--dim)}
ul.checks,ul.plain{list-style:none;margin:0;padding:0}
ul.checks li{padding:4px 0}ul.checks .d{display:block;color:var(--dim);font-size:13px;margin-left:2px}
ul.plain li{color:var(--dim);padding:2px 0}
ol.steps{color:var(--dim);padding-left:20px;margin:0}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--ink)}
.commits{list-style:none;margin:0;padding:0}
.commits li{padding:4px 0;border-top:1px solid var(--line);display:flex;gap:12px;flex-wrap:wrap}
.commits li:first-child{border-top:0}.commits .sha{color:var(--warn)}.commits .when{color:var(--dim)}
footer{margin-top:44px;color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:14px}`;

export function renderPlan(data) {
  const { goal, tasks, ledger, recovery, ownerActions, commits, generatedAt, sources } = data;
  return `<title>Coffee Story Hardening Plan</title>
<style>${STYLE}</style>
<main>
<h1>${esc(goal.objective)}</h1>
<p class="meta">Goal <code>${esc(goal.id)}</code> &middot; refreshed ${esc(generatedAt)} &middot;
${esc(tasks.length)} tasks &middot; ${esc(ledger.cycles.length)} verification cycles</p>

<ul class="tally">${list(counts(tasks), (c) => `<li><b>${c.count}</b> ${esc(c.status.replace("_", " "))}</li>`)}</ul>

<h2>Next action</h2>
<div class="card">${esc(recovery.nextAction)}</div>

<h2>Tasks</h2>
<div class="scroll"><table>
<thead><tr><th>ID</th><th>Task</th><th>Status</th><th>Owner</th></tr></thead>
<tbody>${list(tasks, taskRow)}</tbody></table></div>

<h2>Out of scope</h2>
<div class="card"><ul class="plain">${list(goal.exclusions, (x) => `<li>${esc(x)}</li>`)}</ul></div>

<h2>Verification history</h2>
${list(ledger.cycles, cycle)}

<h2>Owner actions</h2>
<div class="card"><ol class="steps">${list(ownerActions, (a) => `<li>${esc(a)}</li>`)}</ol>
<p class="meta">Full detail in <code>OWNER-ACTIONS.md</code>.</p></div>

<h2>Open risks</h2>
<div class="card"><ul class="plain">${list(recovery.risks, (r) => `<li>${esc(r)}</li>`)}</ul></div>

<h2>Recent commits</h2>
<ul class="commits">${list(commits, (c) => `<li><code class="sha">${esc(c.sha)}</code>
<span>${esc(c.subject)}</span><span class="when">${esc(c.date)}</span></li>`)}</ul>

<footer>Generated by <code>qa/build-plan.mjs</code> from
${list(sources, (s) => `<code>${esc(s)}</code> `)}and <code>git log</code>.
Re-run that script to refresh this page; it holds no hand-authored content.</footer>
</main>`;
}
