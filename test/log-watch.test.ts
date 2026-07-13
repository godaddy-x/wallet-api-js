import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyBackoffWait,
  incrementalNextCursor,
  sleepWithSignal,
  watchIncremental,
} from '../src/client/log-watch.js';

test('incrementalNextCursor advances from rows and limit', () => {
  assert.equal(incrementalNextCursor(0, 100, 0, () => 0), 0);
  assert.equal(incrementalNextCursor(10, 50, 2, (i) => (i === 0 ? 20 : 30)), 50);
  assert.equal(incrementalNextCursor(10, 5, 2, (i) => (i === 0 ? 20 : 30)), 30);
});

test('emptyBackoffWait caps at last step', () => {
  assert.equal(emptyBackoffWait(0), 1000);
  assert.equal(emptyBackoffWait(10), 5000);
});

test('sleepWithSignal rejects when aborted', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stopped'));
  await assert.rejects(() => sleepWithSignal(controller.signal, 1000));
});

test('watchIncremental stops on abort', async () => {
  const controller = new AbortController();
  let calls = 0;
  const task = watchIncremental(controller.signal, 0, 200, async () => {
    calls += 1;
    if (calls >= 2) {
      controller.abort(new Error('done'));
    }
    return { count: 200, nextCursor: calls };
  });
  await assert.rejects(() => task);
  assert.ok(calls >= 2);
});
