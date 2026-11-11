'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const createConfessionFunctions = require('./confessions');

const OWNER_UID = '4grgpBnKA9ROGhxJ0MoPn3yP3MV2';

function harness() {
  const docs = new Map();
  let generated = 0;

  function snapshot(ref) {
    const data = docs.get(ref.path);
    return { id: ref.id, ref, exists: data !== undefined, data: () => data };
  }

  function querySnapshot(path, filters) {
    const prefix = path + '/';
    const found = [...docs.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map((key) => snapshot(ref(key)))
      .filter((doc) => filters.every(([field, op, value]) => {
        const actual = doc.data()[field];
        if (op === '==') return actual === value;
        return false;
      }));
    return { docs: found, size: found.length, empty: found.length === 0 };
  }

  function query(path, filters) {
    const value = {
      path, filters, max: Infinity,
      where(field, op, match) { return query(path, filters.concat([[field, op, match]])); },
      limit(count) { value.max = count; return value; },
      get: async function() {
        const result = querySnapshot(path, filters);
        result.docs = result.docs.slice(0, value.max);
        result.size = result.docs.length;
        result.empty = result.size === 0;
        return result;
      }
    };
    return value;
  }

  function collection(path) {
    return {
      doc: (id) => ref(path + '/' + (id || 'generated-' + (++generated))),
      where: (field, op, match) => query(path, [[field, op, match]]),
      limit: (count) => query(path, []).limit(count),
      get: async () => querySnapshot(path, [])
    };
  }

  function ref(path) {
    return {
      path, id: path.split('/').pop(),
      get: async () => snapshot(ref(path)),
      collection: (name) => collection(path + '/' + name)
    };
  }

  const db = {
    collection,
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (target) => target.filters ? target.get() : snapshot(target),
        getAll: async (...targets) => targets.map((target) => snapshot(target)),
        create: (target, data) => writes.push(() => {
          if (docs.has(target.path)) throw Error('document already exists');
          docs.set(target.path, data);
        }),
        set: (target, data, options) => writes.push(() => {
          docs.set(target.path, options && options.merge ? { ...(docs.get(target.path) || {}), ...data } : data);
        }),
        update: (target, data) => writes.push(() => {
          if (!docs.has(target.path)) throw Error('missing document');
          docs.set(target.path, { ...docs.get(target.path), ...data });
        }),
        delete: (target) => writes.push(() => docs.delete(target.path))
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    }
  };

  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  const firestore = { FieldValue: { serverTimestamp: () => 'server-time' } };

  const api = createConfessionFunctions(
    db, firestore, HttpsError, (options, handler) => handler
  );

  docs.set('staffRoles/' + OWNER_UID, { role: 'owner' });
  docs.set('staffRoles/admin', { role: 'admin' });
  docs.set('staffRoles/moderator', { role: 'moderator' });

  function auditEntries() {
    return [...docs.keys()].filter((key) => key.startsWith('adminAudit/')).map((key) => docs.get(key));
  }

  return { api, db, docs, auditEntries };
}

function staff(uid, role) {
  return { auth: { uid, token: { role } } };
}

function member(uid) {
  return { auth: { uid, token: {} } };
}

test('createConfession validates text and stores the confession with a private author record', async () => {
  const h = harness();

  await assert.rejects(h.api.createConfession({ data: { text: 'Hello' } }), { code: 'unauthenticated' });
  await assert.rejects(h.api.createConfession({ ...member('alice'), data: { text: '' } }), { code: 'invalid-argument' });
  await assert.rejects(h.api.createConfession({ ...member('alice'), data: { text: 'x'.repeat(1001) } }), { code: 'invalid-argument' });
  await assert.rejects(h.api.createConfession({ ...member('alice'), data: {} }), { code: 'invalid-argument' });

  const result = await h.api.createConfession({ ...member('alice'), data: { text: 'A quiet confession' } });
  assert.equal(typeof result.id, 'string');
  assert.equal(result.id.length > 0, true);

  const confession = h.docs.get('confessions/' + result.id);
  assert.equal(confession.text, 'A quiet confession');
  assert.equal(confession.status, 'visible');
  assert.equal(confession.createdAt, 'server-time');
  assert.equal(confession.uid, undefined);

  const author = h.docs.get('confessionAuthors/' + result.id);
  assert.equal(author.uid, 'alice');

  assert.equal(h.auditEntries().some((entry) => entry.action === 'confession.created' && entry.actor === 'alice'), true);
});

test('deleteConfession is author-only and removes the confession and its author record', async () => {
  const h = harness();
  h.docs.set('confessions/c1', { text: 'Secret', status: 'visible', createdAt: 'server-time' });
  h.docs.set('confessionAuthors/c1', { uid: 'alice' });

  await assert.rejects(h.api.deleteConfession({ ...member('bob'), data: { id: 'c1' } }), { code: 'permission-denied' });
  assert.equal(h.docs.has('confessions/c1'), true);
  assert.equal(h.docs.has('confessionAuthors/c1'), true);

  await assert.rejects(h.api.deleteConfession({ ...member('alice'), data: { id: 'not/a/path' } }), { code: 'invalid-argument' });

  const result = await h.api.deleteConfession({ ...member('alice'), data: { id: 'c1' } });
  assert.equal(result.deleted, true);
  assert.equal(h.docs.has('confessions/c1'), false);
  assert.equal(h.docs.has('confessionAuthors/c1'), false);
  assert.equal(h.auditEntries().some((entry) => entry.action === 'confession.deleted' && entry.actor === 'alice' && entry.target === 'c1'), true);
});

test('moderateConfession requires staff and quarantines, restores and deletes confessions', async () => {
  const h = harness();
  h.docs.set('confessions/c2', { text: 'Reported', status: 'visible', createdAt: 'server-time' });
  h.docs.set('confessionAuthors/c2', { uid: 'alice' });

  await assert.rejects(h.api.moderateConfession({ ...member('alice'), data: { id: 'c2', action: 'quarantine' } }), { code: 'permission-denied' });
  await assert.rejects(h.api.moderateConfession({ ...staff('admin', 'admin'), data: { id: 'c2', action: 'pin' } }), { code: 'invalid-argument' });
  assert.equal(h.docs.get('confessions/c2').status, 'visible');

  const quarantined = await h.api.moderateConfession({ ...staff('admin', 'admin'), data: { id: 'c2', action: 'quarantine' } });
  assert.equal(quarantined.moderated, true);
  assert.equal(h.docs.get('confessions/c2').status, 'quarantined');

  const restored = await h.api.moderateConfession({ ...staff('moderator', 'moderator'), data: { id: 'c2', action: 'restore' } });
  assert.equal(restored.moderated, true);
  assert.equal(h.docs.get('confessions/c2').status, 'visible');

  const deleted = await h.api.moderateConfession({ ...staff(OWNER_UID, 'owner'), data: { id: 'c2', action: 'delete' } });
  assert.equal(deleted.moderated, true);
  assert.equal(h.docs.has('confessions/c2'), false);
  assert.equal(h.docs.has('confessionAuthors/c2'), false);

  const audits = h.auditEntries().filter((entry) => entry.action === 'confession.moderated');
  assert.deepEqual(audits.map((entry) => entry.details.action), ['quarantine', 'restore', 'delete']);
});

test('listConfessionQueue is staff-only, returns only quarantined confessions and never exposes author uid', async () => {
  const h = harness();
  h.docs.set('confessions/q1', { text: 'Quarantined one', status: 'quarantined', createdAt: { toMillis: () => 123 } });
  h.docs.set('confessions/q2', { text: 'Quarantined two', status: 'quarantined', createdAt: { toMillis: () => 456 } });
  h.docs.set('confessions/v1', { text: 'Visible', status: 'visible', createdAt: { toMillis: () => 789 } });
  h.docs.set('confessionAuthors/q1', { uid: 'alice' });

  await assert.rejects(h.api.listConfessionQueue({ ...member('alice') }), { code: 'permission-denied' });

  const result = await h.api.listConfessionQueue({ ...staff('admin', 'admin') });
  assert.equal(result.items.length, 2);
  assert.equal(result.items.some((item) => item.status !== 'quarantined'), false);
  assert.equal(result.items.some((item) => Object.prototype.hasOwnProperty.call(item, 'uid')), false);
  assert.equal(result.items.every((item) => ['id', 'text', 'createdAt', 'status'].every((key) => Object.prototype.hasOwnProperty.call(item, key))), true);
  assert.equal(result.items.every((item) => typeof item.text === 'string'), true);
  assert.equal(h.auditEntries().some((entry) => entry.action === 'confession.queue_viewed'), true);
});
