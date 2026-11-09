'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const createModerationFunctions = require('./moderation');

const OWNER_UID = '4grgpBnKA9ROGhxJ0MoPn3yP3MV2';
const DAY_MS = 24 * 60 * 60 * 1000;

function harness() {
  const docs = new Map();
  const objects = new Map();
  let generated = 0;
  const nowMs = 2_000_000_000_000;

  function snapshot(ref) {
    const data = docs.get(ref.path);
    return { id: ref.id, ref, exists: data !== undefined, data: () => data };
  }
  function querySnapshot(path, filters, group) {
    const found = [...docs.keys()].filter((key) => {
      if (group) return key.split('/').at(-2) === path;
      return key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/');
    }).map((key) => snapshot(ref(key))).filter((doc) =>
      filters.every(([field, op, value]) => {
        const actual = doc.data()[field];
        if (op === '==') return actual === value;
        if (op === '<=') return actual.toMillis() <= value.toMillis();
        if (op === 'in') return value.includes(actual);
        return false;
      }));
    return { docs: found, size: found.length, empty: found.length === 0 };
  }
  function query(path, filters, group) {
    const value = {
      path, filters, group, max: Infinity,
      where(field, op, match) { return query(path, filters.concat([[field, op, match]]), group); },
      limit(count) { return Object.assign(query(path, filters, group), { max: count }); },
      get: async function() {
        const result = querySnapshot(path, filters, group);
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
      where: (field, op, value) => query(path, [[field, op, value]]),
      limit: (count) => query(path, []).limit(count),
      get: async () => querySnapshot(path, [], false)
    };
  }
  function ref(path) {
    return {
      path, id: path.split('/').pop(),
      get: async () => snapshot(ref(path)),
      update: async (data) => {
        if (!docs.has(path)) throw Error('missing document');
        docs.set(path, { ...docs.get(path), ...data });
      },
      collection: (name) => collection(path + '/' + name)
    };
  }
  const db = {
    collection,
    collectionGroup: (name) => query(name, [], true),
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
    },
    recursiveDelete: async (target) => {
      for (const path of [...docs.keys()]) {
        if (path === target.path || path.startsWith(target.path + '/')) docs.delete(path);
      }
    }
  };
  function file(path) {
    return {
      name: path,
      exists: async () => [objects.has(path)],
      getMetadata: async () => [objects.get(path).metadata],
      setMetadata: async (patch) => {
        const object = objects.get(path);
        if (!object) throw Error('missing object');
        const metadata = { ...(object.metadata.metadata || {}) };
        Object.entries(patch.metadata || {}).forEach(([key, value]) => {
          if (value === null) delete metadata[key];
          else metadata[key] = value;
        });
        object.metadata = { ...object.metadata, metadata };
      },
      copy: async (destination, options) => {
        if (!objects.has(path)) throw Error('missing source');
        const copied = structuredClone(objects.get(path));
        if (options && options.metadata) {
          copied.metadata = {
            ...copied.metadata,
            contentType: options.contentType || copied.metadata.contentType,
            metadata: options.metadata
          };
        }
        objects.set(destination.name, copied);
        return [destination];
      },
      delete: async (options) => {
        if (!objects.has(path) && !(options && options.ignoreNotFound)) throw Error('missing object');
        objects.delete(path);
      }
    };
  }
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  class Timestamp {
    constructor(value) { this.value = value; }
    toMillis() { return this.value; }
    static now() { return new Timestamp(nowMs); }
    static fromMillis(value) { return new Timestamp(value); }
  }
  const firestore = {
    FieldValue: { serverTimestamp: () => 'server-time' },
    Timestamp,
    FieldPath: { documentId: () => '__name__' }
  };
  const api = createModerationFunctions(
    db, { file }, firestore, HttpsError,
    (options, handler) => handler,
    (options, handler) => handler
  );
  docs.set('staffRoles/' + OWNER_UID, { role: 'owner' });
  docs.set('staffRoles/admin', { role: 'admin' });
  docs.set('staffRoles/moderator', { role: 'moderator' });

  function addMember(uid, shared) {
    const path = 'users/' + uid + '/gallery/item.png';
    const item = { path, name: 'Image', type: 'image/png', visibility: shared ? 'community' : 'private' };
    docs.set('users/' + uid, { uid, username: uid, communityVisible: shared, interestMedia: [item] });
    docs.set('communityProfiles/' + uid, {
      uid, visible: true, profileVisible: shared, username: uid,
      interestMedia: shared ? [item] : [], sharedPostIds: { 's_item.png': true }
    });
    objects.set(path, {
      bytes: Buffer.from('original'),
      metadata: { contentType: 'image/png', metadata: { visibility: item.visibility, firebaseStorageDownloadTokens: 'secret-token' } }
    });
    return { path, item };
  }
  return { api, db, docs, objects, addMember, nowMs };
}

function staff(uid, role) {
  return { auth: { uid, token: { role } } };
}

test('quarantine revokes download token, privately moves media, and sets a 365-day expiry', async () => {
  const h = harness();
  const { path } = h.addMember('member', true);
  const result = await h.api.quarantineGalleryItem({
    ...staff('admin', 'admin'),
    data: { uid: 'member', path, reason: 'Shared without consent' }
  });
  const record = h.docs.get('galleryModeration/member/items/gallery~item.png');
  assert.equal(result.quarantined, true);
  assert.equal(record.status, 'quarantined');
  assert.equal(record.expiresAt.toMillis(), h.nowMs + 365 * DAY_MS);
  assert.equal(h.objects.has(path), false);
  assert.equal(h.objects.has(record.quarantinePath), true);
  assert.equal(h.objects.get(record.quarantinePath).metadata.metadata.firebaseStorageDownloadTokens, undefined);
  assert.equal(h.docs.get('galleryModeration/member').activeCount, 1);
});

test('a failed quarantine can be retried from its gated state', async () => {
  const h = harness();
  const { path } = h.addMember('member', true);
  const quarantinePath = 'moderationQuarantine/member/retry-copy';
  h.objects.delete(path);
  h.objects.set(quarantinePath, {
    bytes: Buffer.from('private copy'),
    metadata: { contentType: 'image/png', metadata: {} }
  });
  h.docs.set('galleryModeration/member', { activeCount: 1 });
  h.docs.set('galleryModeration/member/items/gallery~item.png', {
    ownerUid: 'member', path, quarantinePath, status: 'quarantining',
    visibility: 'community', expiresAt: { toMillis: () => h.nowMs + 365 * DAY_MS }
  });

  const result = await h.api.quarantineGalleryItem({
    ...staff('admin', 'admin'),
    data: { uid: 'member', path, reason: 'Shared without consent' }
  });

  assert.equal(result.quarantined, true);
  assert.equal(h.docs.get('galleryModeration/member/items/gallery~item.png').status, 'quarantined');
  assert.equal(h.objects.has(quarantinePath), true);
});

test('moderators cannot quarantine a private gallery item', async () => {
  const h = harness();
  const { path } = h.addMember('private-member', false);
  await assert.rejects(h.api.quarantineGalleryItem({
    ...staff('moderator', 'moderator'),
    data: { uid: 'private-member', path, reason: 'Review' }
  }), { code: 'permission-denied' });
  assert.equal(h.objects.has(path), true);
  assert.equal(h.docs.has('galleryModeration/private-member'), false);
});

test('restore returns media without restoring its old bearer download token and removes the access gate', async () => {
  const h = harness();
  const { path } = h.addMember('member', true);
  await h.api.quarantineGalleryItem({
    ...staff('admin', 'admin'),
    data: { uid: 'member', path, reason: 'Shared without consent' }
  });
  const result = await h.api.restoreGalleryItem({
    ...staff('admin', 'admin'),
    data: { uid: 'member', id: 'gallery~item.png' }
  });
  assert.equal(result.restored, true);
  assert.equal(h.objects.has(path), true);
  assert.equal(h.objects.get(path).metadata.metadata.visibility, 'community');
  assert.equal(h.objects.get(path).metadata.metadata.firebaseStorageDownloadTokens, undefined);
  assert.equal(h.docs.has('galleryModeration/member/items/gallery~item.png'), false);
  assert.equal(h.docs.has('galleryModeration/member'), false);
});

test('expired quarantines delete media, profile references and engagement', async () => {
  const h = harness();
  const { path } = h.addMember('member', true);
  const quarantinePath = 'moderationQuarantine/member/gallery~item.png-random';
  const ref = h.db.collection('galleryModeration').doc('member').collection('items').doc('gallery~item.png');
  h.docs.set('galleryModeration/member', { activeCount: 1 });
  h.docs.set(ref.path, {
    ownerUid: 'member', path, quarantinePath, itemId: ref.id, postId: 's_item.png',
    visibility: 'community', status: 'quarantined',
    expiresAt: { toMillis: () => h.nowMs - 1 }
  });
  h.objects.set(quarantinePath, {
    bytes: Buffer.from('original'),
    metadata: { contentType: 'image/png', metadata: { visibility: 'community' } }
  });
  h.docs.set('galleryEngagement/member/posts/s_item.png/comments/comment', { text: 'comment' });
  const result = await h.api.expireQuarantinedGalleryItems();
  assert.equal(result.removed, 1);
  assert.equal(h.objects.has(path), false);
  assert.equal(h.objects.has(quarantinePath), false);
  assert.equal(h.docs.get('users/member').interestMedia.length, 0);
  assert.equal(h.docs.get('communityProfiles/member').interestMedia.length, 0);
  assert.equal(h.docs.has('galleryEngagement/member/posts/s_item.png/comments/comment'), false);
  assert.equal(h.docs.has(ref.path), false);
  assert.equal(h.docs.has('galleryModeration/member'), false);
});
