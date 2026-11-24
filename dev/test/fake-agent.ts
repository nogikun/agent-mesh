// Fake provider emulating the verified claude/codex output contracts, so the mesh loop is testable without an LLM.
// Prompt directives: DELEGATE:<peer>:<text>  -> runs `mesh send` from inside the turn (like a real agent would)
//                    SLEEP:<ms>              -> long-running turn
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [flavor, ...args] = process.argv.slice(2);
const prompt = readFileSync(0, 'utf8');
const resumeIdx = flavor === 'claude' ? args.indexOf('--resume') + 1 : args.indexOf('resume') >= 0 ? args.length - 2 : 0;
const session = resumeIdx > 0 ? args[resumeIdx] : randomUUID();

let text: string;
const sleep = /SLEEP:(\d+)/.exec(prompt);
if (sleep) await new Promise((r) => setTimeout(r, Number(sleep[1])));
const del = /DELEGATE:([\w-]+):(.+)/.exec(prompt);
if (resumeIdx > 0) {
  text = `RESUMED ${session}: ${prompt}`;
} else if (del) {
  let raw: string;
  try {
    raw = execFileSync('mesh', ['send', '--to', del[1], '--message', del[2]], { encoding: 'utf8' });
  } catch (e) {
    raw = (e as { stdout: string }).stdout; // mesh exits non-zero on errors but still prints JSON
  }
  const r = JSON.parse(raw);
  text = r.ok ? `delegated ${r.data.requestId}` : `delegate failed ${r.error.code}`;
} else {
  text = `ECHO: ${prompt.split('--- request ---\n')[1] ?? prompt}`;
}

if (flavor === 'claude') {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: session, result: text, permission_denials: [] }));
} else {
  for (const e of [
    { type: 'thread.started', thread_id: session }, { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text } }, { type: 'turn.completed', usage: {} },
  ]) process.stdout.write(JSON.stringify(e) + '\n');
}
