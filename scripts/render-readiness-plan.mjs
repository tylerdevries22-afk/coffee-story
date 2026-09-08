import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ledger = JSON.parse(await readFile(resolve(root, 'qa/task-ledger.json'), 'utf8'));
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const items = (values, kind) => values.map((value) =>
  `<li><span class="state ${kind}">${escape(kind)}</span>${escape(value)}</li>`).join('');
const checks = ledger.verification.map((entry) =>
  `<li><strong>${escape(entry.task)}</strong><span>${escape(entry.evidence)}</span></li>`).join('');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Production readiness progress</title><style>
:root{color-scheme:light;font:16px/1.5 Inter,system-ui;color:#171717;background:#f5f4f0}
*{box-sizing:border-box}body{margin:0;padding:48px 24px}main{max-width:980px;margin:auto}.hero,.card{background:#ffffffc9;border:1px solid #ddd9cf;border-radius:24px;box-shadow:0 18px 55px #2d291c12;backdrop-filter:blur(18px)}.hero{padding:32px}.eyebrow{letter-spacing:.14em;text-transform:uppercase;color:#766d5a;font-size:.75rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}.card{padding:24px}h1{font-size:clamp(2rem,5vw,4rem);line-height:1;margin:.25em 0}.metric{font-size:2rem;font-weight:700}ul{list-style:none;padding:0;margin:0}li{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #ebe8e0}li span:last-child{display:block}.state{font-size:.72rem;text-transform:uppercase;min-width:76px;color:#625b4e}.done{color:#26734d}.active{color:#956900}.blocked{color:#a33a2c}@media(max-width:700px){body{padding:16px}.grid{grid-template-columns:1fr}.hero,.card{border-radius:18px}}
</style></head><body><main><section class="hero"><div class="eyebrow">Swarm Auto · coordinator-only fallback</div><h1>Production &amp; franchise readiness</h1><p>Goal ${escape(ledger.goalId)} · branch ${escape(ledger.workingBranch)}</p><div class="metric">${ledger.completed.length}/${ledger.completed.length + ledger.inProgress.length + ledger.remaining.length}</div><p>tasks verified complete · refreshed ${escape(ledger.refreshedAt)}</p></section><div class="grid"><section class="card"><h2>In progress</h2><ul>${items(ledger.inProgress,'active')}</ul></section><section class="card"><h2>Remaining</h2><ul>${items(ledger.remaining,'blocked')}</ul></section><section class="card"><h2>Evidence</h2><ul>${checks}</ul></section><section class="card"><h2>Current constraints</h2><ul>${items(ledger.blockers,'blocked')}</ul><h3>Next action</h3><p>${escape(ledger.nextAction)}</p></section></div></main></body></html>`;
await writeFile(resolve(root, 'plan.html'), html);
