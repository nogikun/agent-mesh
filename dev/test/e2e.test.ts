// Two runtimes on loopback (host A: claude-dev, host B: codex-dev) with fake providers. No LLM is invoked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { startRuntime } from '../src/runtime.ts';
import { startConnector } from '../src/connector.ts';
import { loadConfig, type Config } from '../src/config.ts';

const FAKE = resolve(import.meta.dirname, 'fake-agent.ts');
const MESH = resolve(import.meta.dirname, '../bin/mesh');
const fake = (flavor: string) => ['node', '--disable-warning=ExperimentalWarning', FAKE, flavor];
const dir = mkdtempSync(join(tmpdir(), 'mesh-e2e-'));

const freePort = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });

let A: Config & { path: string }, B: Config & { path: string };
let rtA: Awaited<ReturnType<typeof startRuntime>>, rtB: Awaited<ReturnType<typeof startRuntime>>;
let gwRw: Awaited<ReturnType<typeof startConnector>>, gwRo: Awaited<ReturnType<typeof startConnector>>;

async function local(c: Config, method: string, body: object = {}, token = c.localToken) {
  const r = await fetch(`http://127.0.0.1:${c.port}/local/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json() as Promise<{ ok: boolean; data: any; error?: { code: string; message: string; requestId: string } }>;
}
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  const [pa, pb] = [await freePort(), await freePort()];
  const ua = `http://127.0.0.1:${pa}`, ub = `http://127.0.0.1:${pb}`;
  const policy = { maxConcurrentTurns: 2, defaultDeadlineSeconds: 60 };
  const a: Config = {
    schemaVersion: '1.0', nodeId: 'host-a', port: pa, publicUrl: ua, dbPath: 'a.db', localToken: 'local-a-token-xxxxxxxx',
    callers: [{ id: 'host-b', token: 'b-to-a-token-xxxxxxxx', pushOrigin: ub }, { id: 'host-a', token: 'a-to-a-token-xxxxxxxx', pushOrigin: ua }],
    agents: [{ id: 'claude-dev', provider: 'claude', workspace: dir, allowedSenders: ['host-a', 'host-b'], allowedPeers: ['codex-dev'], autoResume: true, command: fake('claude') }],
    peers: [{ id: 'codex-dev', url: `${ub}/agents/codex-dev`, token: 'a-to-b-token-xxxxxxxx' }, { id: 'claude-dev', url: `${ua}/agents/claude-dev`, token: 'a-to-a-token-xxxxxxxx' },
      { id: 'bad-cred', url: `${ub}/agents/codex-dev`, token: 'wrong-token-xxxxxxxxxx' }, { id: 'ghost', url: `${ub}/agents/ghost`, token: 'a-to-b-token-xxxxxxxx' }],
    connectors: [
      { id: 'muse', token: 'conn-muse-token-xxxxxxxx', apiKey: 'muse-api-key-xxxxxxxxxxxx', port: await freePort(), allowedPeers: ['codex-dev'] },
      { id: 'viewer', token: 'conn-view-token-xxxxxxxx', apiKey: 'view-api-key-xxxxxxxxxxxx', port: await freePort(), allowedPeers: ['codex-dev'], readOnly: true },
    ],
    policy,
  };
  const b: Config = {
    schemaVersion: '1.0', nodeId: 'host-b', port: pb, publicUrl: ub, dbPath: 'b.db', localToken: 'local-b-token-xxxxxxxx',
    callers: [{ id: 'host-a', token: 'a-to-b-token-xxxxxxxx', pushOrigin: ua }],
    agents: [{ id: 'codex-dev', provider: 'codex', workspace: dir, allowedSenders: ['host-a'], allowedPeers: [], command: fake('codex') }],
    peers: [{ id: 'claude-dev', url: `${ua}/agents/claude-dev`, token: 'b-to-a-token-xxxxxxxx' }],
    policy,
  };
  writeFileSync(join(dir, 'a.json'), JSON.stringify(a), { mode: 0o600 });
  writeFileSync(join(dir, 'b.json'), JSON.stringify(b), { mode: 0o600 });
  A = loadConfig(join(dir, 'a.json'));
  B = loadConfig(join(dir, 'b.json'));
  rtA = await startRuntime(A);
  rtB = await startRuntime(B);
  gwRw = await startConnector(A, A.connectors![0]);
  gwRo = await startConnector(A, A.connectors![1]);
});
after(async () => { await gwRw?.close(); await gwRo?.close(); await rtA?.close(); await rtB?.close(); });

test('AT04/AT05: async send returns at once, result arrives by push (no polling of the agent)', async () => {
  const r = await local(A, 'send', { to: 'codex-dev', message: 'SLEEP:300 hello', idempotencyKey: 'k-async-1' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.state, 'SUBMITTED', 'returns before the remote turn finishes');
  assert.match(r.data.remoteTaskId, /^tsk_/);
  const ev = await until(async () => (await local(A, 'inbox')).data.events.find((e: any) => e.requestId === r.data.requestId));
  assert.equal(ev.state, 'COMPLETED');
  const g = await local(A, 'get', { id: r.data.requestId });
  assert.equal(g.data.state, 'COMPLETED');
  assert.match(g.data.result, /ECHO: SLEEP:300 hello/);
});

test('AT06: same idempotency key -> one task; different payload -> CONFLICT', async () => {
  const one = await local(A, 'send', { to: 'codex-dev', message: 'idem', idempotencyKey: 'k-idem' });
  const two = await local(A, 'send', { to: 'codex-dev', message: 'idem', idempotencyKey: 'k-idem' });
  assert.equal(one.data.remoteTaskId, two.data.remoteTaskId);
  const bad = await local(A, 'send', { to: 'codex-dev', message: 'other', idempotencyKey: 'k-idem' });
  assert.equal(bad.error?.code, 'CONFLICT');
  const n = new DatabaseSync(B.dbPath).prepare("SELECT COUNT(*) AS n FROM tasks WHERE idempotency_key='k-idem'").get() as { n: number };
  assert.equal(n.n, 1);
});

test('AT03/AT15: unauthenticated and unauthorized callers are refused', async () => {
  const rpc = (token: string) => fetch(`${B.publicUrl}/agents/codex-dev`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { messageId: 'x', parts: [{ kind: 'text', text: 'hi' }] } } }),
  });
  assert.equal((await rpc('wrong')).status, 401);
  assert.equal((await local(A, 'status', {}, 'wrong-local')).ok, undefined); // 401 body has no ok field
  // host-b may not send to codex-dev (not in allowedSenders): it would need its own caller entry; use push origin check instead
  const evil = await fetch(`${B.publicUrl}/agents/codex-dev`, {
    method: 'POST', headers: { authorization: 'Bearer a-to-b-token-xxxxxxxx', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'message/send', params: { message: { messageId: 'evil-1', parts: [{ kind: 'text', text: 'hi' }] }, configuration: { pushNotificationConfig: { url: 'http://169.254.169.254/latest', token: 'xxxxxxxxxxxxxxxxxxxx' } } } }),
  });
  assert.equal(((await evil.json()) as any).error.data.meshCode, 'FORBIDDEN', 'push URL outside caller origin is refused (SSRF)');
  const card = await (await fetch(`${B.publicUrl}/agents/codex-dev/.well-known/agent-card.json`)).json() as any;
  assert.equal(card.capabilities.pushNotifications, true);
  assert.ok(!JSON.stringify(card).includes(dir), 'card leaks no local paths');
});

test('UC01/AT08: claude delegates to codex inside its turn, then is auto-resumed with the result', async () => {
  const r = await local(A, 'send', { to: 'claude-dev', message: 'DELEGATE:codex-dev:review module X' });
  assert.ok(r.ok, JSON.stringify(r));
  const g = await until(async () => {
    const x = await local(A, 'get', { id: r.data.requestId });
    return x.data.state === 'COMPLETED' && x.data;
  });
  // the upstream caller gets the final answer of the resumed turn, not the interim "delegated" text
  assert.match(g.result, /RESUMED/);
  assert.match(g.result, /ECHO: review module X/);
  assert.match(g.result, /<remote-result request="req_/, 'result is wrapped as untrusted data');
  const originId = g.remoteTaskId; // claude-dev's task on host A
  const o = await local(A, 'get', { id: originId });
  assert.equal(o.data.continuations.length, 1);
  assert.equal(o.data.continuations[0].status, 'DONE');
  const child = new DatabaseSync(A.dbPath).prepare("SELECT depth, origin_task_id FROM tasks WHERE direction='out' AND origin_task_id=?").get(originId) as any;
  assert.equal(child.depth, 1);
});

test('AT07: duplicate push is ignored (no second inbox event)', async () => {
  const db = new DatabaseSync(A.dbPath);
  const t = db.prepare("SELECT * FROM tasks WHERE direction='out' AND state='COMPLETED' AND peer_id='codex-dev' LIMIT 1").get() as any;
  const before = (db.prepare('SELECT COUNT(*) AS n FROM inbox').get() as any).n;
  const res = await fetch(`${A.publicUrl}/push`, { method: 'POST', headers: { 'x-a2a-notification-token': t.push_token, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'task', id: t.remote_task_id, status: { state: 'working' } }) });
  assert.equal(res.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM inbox').get() as any).n, before);
  assert.equal((db.prepare('SELECT state FROM tasks WHERE task_id=?').get(t.task_id) as any).state, 'COMPLETED', 'stale push cannot rewind terminal');
  const forged = await fetch(`${A.publicUrl}/push`, { method: 'POST', headers: { 'x-a2a-notification-token': 'nope', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(forged.status, 401);
});

test('AT15: an agent without allowedPeers cannot delegate', async () => {
  // codex-dev has allowedPeers: [] -> its turn token may not send. Simulate via host A sending a DELEGATE to codex-dev.
  const r = await local(A, 'send', { to: 'codex-dev', message: 'DELEGATE:claude-dev:anything' });
  const g = await until(async () => { const x = await local(A, 'get', { id: r.data.requestId }); return x.data.state === 'COMPLETED' && x.data; });
  assert.match(g.result, /delegate failed (FORBIDDEN|NOT_FOUND)/);
});

test('definitive refusals are final; plain HTTP errors keep their message', async () => {
  const denied = await local(A, 'send', { to: 'bad-cred', message: 'x' });
  assert.equal(denied.error?.code, 'FORBIDDEN');
  const t = await local(A, 'get', { id: denied.error!.requestId });
  assert.equal(t.data.state, 'FAILED', 'refused send does not stay SUBMITTED');
  const ghost = await local(A, 'send', { to: 'ghost', message: 'x' });
  assert.equal(ghost.error?.code, 'TRANSPORT_ERROR');
  assert.match(ghost.error!.message, /404: unknown agent/);
});

test('AT10: cancel a running remote task', async () => {
  const r = await local(A, 'send', { to: 'codex-dev', message: 'SLEEP:5000 long' });
  await until(async () => (new DatabaseSync(B.dbPath).prepare('SELECT state FROM tasks WHERE task_id=?').get(r.data.remoteTaskId) as any)?.state === 'WORKING');
  const c = await local(A, 'cancel', { id: r.data.requestId });
  assert.ok(c.ok, JSON.stringify(c));
  const g = await until(async () => { const x = await local(A, 'get', { id: r.data.requestId }); return x.data.state === 'CANCELED' && x.data; });
  assert.equal(g.state, 'CANCELED');
});

test('CLI: mesh send / task get via bin/mesh', async () => {
  const run = promisify(execFile);
  const env = { ...process.env, MESH_TURN_TOKEN: '' };
  const s = JSON.parse((await run(MESH, ['send', '--config', A.path, '--to', 'codex-dev', '--message', 'from cli', '--json'], { env })).stdout);
  assert.ok(s.ok);
  const g = await until(async () => { const x = JSON.parse((await run(MESH, ['task', 'get', s.data.requestId, '--config', A.path], { env })).stdout); return x.data.state === 'COMPLETED' && x; });
  assert.match(g.data.result, /from cli/);
  const err = await run(MESH, ['task', 'get', 'req_nope', '--config', A.path], { env }).catch((e) => e);
  assert.equal(err.code, 5, 'NOT_FOUND exit code');
  const esc = await run(MESH, ['send', '--config', A.path, '--to', 'codex-dev', '--message', 'x'], { env: { ...env, MESH_TURN_TOKEN: 'tok', MESH_URL: A.publicUrl } }).catch((e) => e);
  assert.equal(JSON.parse(esc.stdout).error.code, 'FORBIDDEN', 'a turn cannot escalate with --config');
  const inside = await run(MESH, ['init-demo', '--dir', join(dir, '.mesh'), '--workspace', dir], { env }).catch((e) => e);
  assert.equal(JSON.parse(inside.stdout).error.code, 'INVALID_ARGUMENT', 'tokens may not live inside the workspace');
});

test('AT14: restart marks interrupted work FAILED instead of re-running it', async () => {
  await rtB.close();
  const db = new DatabaseSync(B.dbPath);
  db.prepare(`INSERT INTO tasks(task_id, direction, agent_id, peer_id, state, input, idempotency_key, payload_hash, root_id, deadline_at, created_at, updated_at)
    VALUES ('tsk_crash', 'in', 'codex-dev', 'host-a', 'WORKING', 'x', 'k-crash', 'h', 'tsk_crash', 0, 'now', 'now')`).run();
  db.close();
  rtB = await startRuntime(B);
  const t = new DatabaseSync(B.dbPath).prepare("SELECT state, error FROM tasks WHERE task_id='tsk_crash'").get() as any;
  assert.equal(t.state, 'FAILED');
  assert.match(t.error, /INTERRUPTED/);
});

// ---------- Muse connector gateway (MCP over Streamable HTTP) ----------
let rpcId = 0;
async function mcp(url: string, method: string, params?: object, key = 'muse-api-key-xxxxxxxxxxxx', headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return { status: res.status, body: res.status === 202 ? null : await res.json() as any };
}
const call = async (name: string, args: object, url = gwRw.url, key?: string) => (await mcp(url, 'tools/call', { name, arguments: args }, key)).body.result;

test('MCP: handshake, tool list, and read-only connectors hide write tools', async () => {
  const init = await mcp(gwRw.url, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.ok(init.body.result.capabilities.tools);
  const note = await fetch(gwRw.url, { method: 'POST', headers: { authorization: 'Bearer muse-api-key-xxxxxxxxxxxx', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(note.status, 202);
  const rw = (await mcp(gwRw.url, 'tools/list')).body.result.tools.map((t: any) => t.name);
  assert.deepEqual(rw, ['mesh_list_agents', 'mesh_submit_task', 'mesh_get_task', 'mesh_cancel_task']);
  const ro = (await mcp(gwRo.url, 'tools/list', {}, 'view-api-key-xxxxxxxxxxxx')).body.result.tools.map((t: any) => t.name);
  assert.deepEqual(ro, ['mesh_list_agents', 'mesh_get_task']);
  const denied = await mcp(gwRo.url, 'tools/call', { name: 'mesh_submit_task', arguments: {} }, 'view-api-key-xxxxxxxxxxxx');
  assert.equal(denied.body.error.code, -32602);
});

test('MCP: wrong key, foreign Origin and GET are refused', async () => {
  assert.equal((await mcp(gwRw.url, 'tools/list', {}, 'wrong')).status, 401);
  assert.equal((await mcp(gwRw.url, 'tools/list', {}, undefined, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(gwRw.url, { headers: { authorization: 'Bearer muse-api-key-xxxxxxxxxxxx' } })).status, 405);
  assert.equal((await mcp(gwRw.url, 'tools/list', {}, 'view-api-key-xxxxxxxxxxxx')).status, 401, 'keys are per connector');
});

test('MCP: submit -> get result; only allowed agents; idempotent retries', async () => {
  const agents = await call('mesh_list_agents', {});
  assert.deepEqual(agents.structuredContent.agents.map((a: any) => a.id), ['codex-dev']);
  const args = { agentId: 'codex-dev', message: 'from muse', idempotencyKey: 'muse-key-0000000001' };
  const s1 = await call('mesh_submit_task', args);
  assert.ok(!s1.isError, JSON.stringify(s1));
  const s2 = await call('mesh_submit_task', args);
  assert.equal(s2.structuredContent.taskId, s1.structuredContent.taskId);
  const done = await until(async () => { const g = await call('mesh_get_task', { taskId: s1.structuredContent.taskId }); return g.structuredContent.state === 'COMPLETED' && g; });
  assert.match(done.structuredContent.result, /ECHO: from muse/);
  const other = await call('mesh_submit_task', { agentId: 'claude-dev', message: 'x', idempotencyKey: 'muse-key-0000000002' });
  assert.equal(other.isError, true);
  assert.equal(other.structuredContent.error.code, 'FORBIDDEN');
});

test('MCP: connector cannot see other tasks and arguments are validated', async () => {
  const human = await local(A, 'send', { to: 'codex-dev', message: 'owner task' });
  const peek = await call('mesh_get_task', { taskId: human.data.requestId });
  assert.equal(peek.structuredContent.error.code, 'NOT_FOUND');
  const extra = await call('mesh_submit_task', { agentId: 'codex-dev', message: 'x', idempotencyKey: 'muse-key-0000000003', sudo: true });
  assert.equal(extra.structuredContent.error.code, 'INVALID_ARGUMENT');
  const short = await call('mesh_submit_task', { agentId: 'codex-dev', message: 'x', idempotencyKey: 'short' });
  assert.equal(short.structuredContent.error.code, 'INVALID_ARGUMENT');
  const st = await local(A, 'status', {}, 'conn-muse-token-xxxxxxxx');
  assert.equal(st.error?.code, 'FORBIDDEN', 'connector token cannot use owner-only APIs');
});
