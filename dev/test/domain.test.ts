import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptObserved, canTransition, checkDelegation, fromA2A, isTerminal, toA2A, truncate } from '../src/domain.ts';
import { parseClaude, parseCodex } from '../src/providers.ts';

test('state machine: terminal states are immutable', () => {
  assert.ok(canTransition('SUBMITTED', 'WORKING'));
  assert.ok(!canTransition('SUBMITTED', 'COMPLETED'));
  assert.ok(!canTransition('COMPLETED', 'WORKING'));
  assert.ok(isTerminal('REJECTED'));
  assert.ok(acceptObserved('SUBMITTED', 'COMPLETED'), 'observer may skip intermediate states');
  assert.ok(!acceptObserved('COMPLETED', 'WORKING'), 'terminal never rewinds');
  assert.ok(!acceptObserved('WORKING', 'WORKING'), 'duplicate is ignored');
  assert.ok(!acceptObserved('WORKING', 'SUBMITTED'), 'reordered notification cannot regress (found by codex-dev review)');
  assert.ok(acceptObserved('INPUT_REQUIRED', 'WORKING'));
});

test('A2A state mapping keeps unknown states unknown', () => {
  assert.equal(fromA2A('input-required'), 'INPUT_REQUIRED');
  assert.equal(fromA2A('unknown'), null);
  assert.equal(toA2A('AUTH_REQUIRED'), 'auth-required');
});

test('loop limits', () => {
  assert.equal(checkDelegation(3, 0), null);
  assert.match(checkDelegation(4, 0)!, /depth/);
  assert.match(checkDelegation(1, 10)!, /root/);
});

test('truncate respects byte limit with multibyte text', () => {
  const s = truncate('あ'.repeat(100), 60);
  assert.ok(Buffer.byteLength(s) <= 60, 'marker included in the limit');
  assert.ok(!s.includes('�'), 'no split character');
  assert.equal(truncate('abc', 60), 'abc');
});

test('provider parsers follow the recorded CLI contracts', () => {
  assert.deepEqual(parseClaude('{"type":"result","subtype":"success","is_error":false,"session_id":"s1","result":"PONG","permission_denials":[]}'),
    { state: 'COMPLETED', text: 'PONG', sessionId: 's1' });
  assert.equal(parseClaude('{"subtype":"error_max_turns","is_error":true,"session_id":"s1"}').state, 'FAILED');
  assert.equal(parseClaude('not json').state, 'FAILED');
  assert.equal(parseClaude('null').state, 'FAILED', 'null must not throw');
  assert.equal(parseCodex('null\n{"type":"turn.completed"}').state, 'FAILED', 'null line must not throw');
  const codex = [
    '{"type":"thread.started","thread_id":"t1"}', '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}',
    '{"type":"turn.completed","usage":{}}',
  ].join('\n');
  assert.deepEqual(parseCodex(codex), { state: 'COMPLETED', text: 'PONG', sessionId: 't1' });
  assert.equal(parseCodex('{"type":"thread.started","thread_id":"t1"}').state, 'FAILED', 'no turn.completed is not success');
});
