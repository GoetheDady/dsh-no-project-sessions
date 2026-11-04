import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function createRuntime({ fetchImpl, summary = {} } = {}) {
  const cleanups = [];
  const fetchCalls = [];
  const originalCalls = [];
  const conversation = {
    sendSession: async (...args) => {
      originalCalls.push(args);
      return { sent: true, args };
    },
  };
  const context = {
    console,
    AbortController,
    fetch: async (path, init) => {
      fetchCalls.push({ path, init });
      return fetchImpl(path, init);
    },
    window: undefined,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.window.__ModuleLoader__ = {
    load({ factory }) {
      context.exports = factory((name) => {
        assert.equal(name, 'react');
        // Components are registered, never rendered: no custom React renderer.
        return {};
      });
    },
  };
  vm.runInNewContext(clientSource, context, { filename: 'lib/client.js' });

  const ctx = {
    get: (name) => name === 'conversation' ? conversation : undefined,
    effect: (install, label) => {
      // Exercise only the sendSession lifecycle. UI effects need the real app,
      // not a test DOM or React renderer.
      if (label !== 'no-project-sessions: restore conversation.sendSession') return;
      const cleanup = install();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
    locale: {
      register: () => {},
      bind: () => (key) => key,
    },
    sessions: { list: { getSnapshot: () => ({ byId: { session: summary } }) } },
    workspaces: {},
    slots: { inject: () => {} },
    remote: { $host: { home: '/home/test' } },
    uiWorkspace: { startSession: async () => {} },
  };
  context.exports.apply(ctx);

  return {
    call: (...args) => conversation.sendSession(...args),
    cleanup: () => { while (cleanups.length > 0) cleanups.pop()(); },
    fetchCalls,
    originalCalls,
    conversation,
  };
}

function scratchSummary() {
  return { cwd: '/home/test/Documents/dsh', projectionValues: {} };
}

test('the real exported apply wrapper shares preparation but aborts only one waiter', async () => {
  const response = deferred();
  const runtime = createRuntime({
    fetchImpl: (_path, init) => {
      assert.equal(init.method, 'POST');
      assert.equal(init.signal.aborted, false);
      return response.promise;
    },
    summary: scratchSummary(),
  });
  const session = { sessionId: 'session' };
  const first = runtime.call(session, 'first text', [], 'chat');
  const secondController = new AbortController();
  const second = runtime.call(session, 'second text', [], 'chat', secondController.signal);
  assert.equal(runtime.fetchCalls.length, 1);
  secondController.abort();
  response.resolve({ ok: true, status: 200, json: async () => ({ path: '/home/test/Documents/dsh/2026-11-03/first-text' }) });

  await assert.rejects(second, (error) => error === secondController.signal.reason);
  const result = await first;
  assert.equal(result.sent, true);
  assert.equal(runtime.originalCalls.length, 1);
  assert.equal(runtime.originalCalls[0][1], 'first text');
  assert.equal(runtime.fetchCalls[0].init.signal.aborted, false);
  runtime.cleanup();
});

test('the real exported apply wrapper clears failed preparation so a later send retries', async () => {
  const responses = [
    Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'temporary failure' }) }),
    Promise.resolve({ ok: true, status: 200, json: async () => ({ path: '/home/test/Documents/dsh/2026-11-03/retry' }) }),
  ];
  const runtime = createRuntime({
    fetchImpl: () => responses.shift(),
    summary: scratchSummary(),
  });
  const session = { sessionId: 'session' };
  const failures = await Promise.allSettled([
    runtime.call(session, 'first'),
    runtime.call(session, 'second'),
  ]);
  assert.equal(runtime.fetchCalls.length, 1);
  assert.equal(failures[0].status, 'rejected');
  assert.equal(failures[1].status, 'rejected');
  assert.match(failures[0].reason.message, /temporary failure/);
  assert.equal(runtime.originalCalls.length, 0);

  const success = await runtime.call(session, 'retry');
  assert.equal(success.sent, true);
  assert.equal(runtime.fetchCalls.length, 2);
  assert.equal(runtime.originalCalls.length, 1);
  runtime.cleanup();
});

test('successful shared preparation forwards both sends and clears its pending entry', async () => {
  const response = deferred();
  const runtime = createRuntime({
    fetchImpl: () => response.promise,
    summary: scratchSummary(),
  });
  const session = { sessionId: 'session' };
  const first = runtime.call(session, 'first', ['attachment'], 'chat');
  const second = runtime.call(session, 'second');
  assert.equal(runtime.fetchCalls.length, 1);
  assert.equal(runtime.originalCalls.length, 0);
  response.resolve({ ok: true, status: 200, json: async () => ({ path: '/prepared' }) });
  await Promise.all([first, second]);
  assert.equal(runtime.originalCalls.length, 2);
  assert.equal(runtime.originalCalls[0][1], 'first');
  assert.deepEqual(runtime.originalCalls[0][2], ['attachment']);
  assert.equal(runtime.originalCalls[1][1], 'second');
  // Keep the snapshot stale intentionally: completed promises must not remain
  // cached. The Host is authoritative and will reuse its committed directory.
  await runtime.call(session, 'third');
  assert.equal(runtime.fetchCalls.length, 2);
  assert.equal(runtime.originalCalls.length, 3);
  runtime.cleanup();
});

function loadApply() {
  const context = {
    console,
    AbortController,
    fetch: async () => { throw new Error('fetch must not run'); },
    window: undefined,
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.window.__ModuleLoader__ = {
    load({ factory }) { context.exports = factory(() => ({})); },
  };
  vm.runInNewContext(clientSource, context, { filename: 'lib/client.js' });
  return context.exports.apply;
}

// Mimics cordis: reading a function property through the traceable proxy returns
// a fresh shadow method every time, so `conversation.sendSession === wrapper`
// is never true. Symbol properties are not wrapped.
function createTraceableConversation(originalCalls) {
  const target = {
    sendSession: async (...args) => {
      originalCalls.push(args);
      return { sent: true, args };
    },
  };
  return new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key);
      if (typeof key === 'string' && typeof value === 'function') {
        return function shadowMethod(...args) { return value.apply(this, args); };
      }
      return value;
    },
  });
}

function mountInstance(conversation, summary) {
  let active = true;
  const cleanups = [];
  const ctx = {
    get: (name) => name === 'conversation' ? conversation : undefined,
    effect: (install, label) => {
      if (label !== 'no-project-sessions: restore conversation.sendSession') return;
      const cleanup = install();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
    locale: { register: () => {}, bind: () => (key) => key },
    get sessions() {
      if (!active) throw new Error('cannot get required service "sessions" in inactive context');
      return { list: { getSnapshot: () => ({ byId: { session: summary } }) } };
    },
    workspaces: {},
    slots: { inject: () => {} },
    remote: { $host: { home: '/home/test' } },
    uiWorkspace: { startSession: async () => {} },
  };
  loadApply()(ctx);
  return {
    dispose() {
      while (cleanups.length > 0) cleanups.pop()();
      active = false;
    },
  };
}

test('hot reload never leaves a stale wrapper reading an inactive ctx', async () => {
  const originalCalls = [];
  const conversation = createTraceableConversation(originalCalls);
  const prepared = {
    cwd: '/home/test/Documents/dsh',
    projectionValues: { workingDirectory: '/home/test/Documents/dsh/2026-11-03/prepared' },
  };
  const first = mountInstance(conversation, prepared);
  first.dispose();
  const second = mountInstance(conversation, prepared);

  const result = await conversation.sendSession({ sessionId: 'session' }, 'after reload');
  assert.equal(result.sent, true);
  assert.equal(originalCalls.length, 1);

  second.dispose();
  const afterDispose = await conversation.sendSession({ sessionId: 'session' }, 'after dispose');
  assert.equal(afterDispose.sent, true);
  assert.equal(originalCalls.length, 2);
});

test('a real project whose path merely ends in Documents/dsh is not treated as scratch', async () => {
  const runtime = createRuntime({
    fetchImpl: () => { throw new Error('fetch must not run'); },
    summary: { cwd: '/work/proj/Documents/dsh', projectionValues: {} },
  });
  const result = await runtime.call({ sessionId: 'session' }, 'hello');
  assert.equal(result.sent, true);
  assert.equal(runtime.fetchCalls.length, 0);
  assert.equal(runtime.originalCalls.length, 1);
  runtime.cleanup();
});

test('the real exported apply wrapper leaves prepared sessions untouched', async () => {
  const runtime = createRuntime({
    fetchImpl: () => { throw new Error('fetch must not run'); },
    summary: {
      cwd: '/home/test/Documents/dsh',
      projectionValues: { workingDirectory: '/home/test/Documents/dsh/2026-11-03/already-prepared' },
    },
  });
  const result = await runtime.call({ sessionId: 'session' }, 'already prepared');
  assert.equal(result.sent, true);
  assert.equal(runtime.fetchCalls.length, 0);
  assert.equal(runtime.originalCalls.length, 1);
  runtime.cleanup();
});
