'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createFunctions() {
  const documents = new Map();
  function snapshot(path) {
    const data = documents.get(path);
    return { exists: data !== undefined, data: () => data };
  }
  function collection(path) {
    return {
      doc: (id) => document(path + '/' + id),
      where: (field, operator, value) => ({ limit: (size) => ({ path, field, value, size }) }),
      count: () => ({ get: async () => ({ data: () => ({ count: entries(path).length }) }) }),
      limit: (size) => ({ get: async () => {
        const docs = entries(path).slice(0, size).map((key) => ({ ref: document(key) }));
        return { docs, empty: docs.length === 0 };
      } })
    };
  }
  function entries(path) {
    return [...documents.keys()].filter((key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'));
  }
  function document(path) {
    return { path, collection: (name) => collection(path + '/' + name) };
  }
  const db = {
    collection,
    runTransaction: async (callback) => callback({
      getAll: async (...refs) => refs.map((ref) => snapshot(ref.path)),
      get: async (query) => {
        const docs = entries(query.path).map((path) => ({
          id: path.slice(query.path.length + 1), ...snapshot(path)
        })).filter((doc) => doc.data()[query.field] === query.value).slice(0, query.size);
        return { docs, empty: docs.length === 0 };
      },
      create: (ref, data) => documents.set(ref.path, data)
    }),
    batch: () => {
      const removals = [];
      return { delete: (ref) => removals.push(ref.path), commit: async () => removals.forEach((path) => documents.delete(path)) };
    }
  };
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const firestore = () => db;
  firestore.FieldValue = { serverTimestamp: () => 'timestamp' };
  const stubs = {
    'firebase-admin': {
      initializeApp() {}, firestore,
      storage: () => ({ bucket: () => ({ file: () => ({}) }) })
    },
    'firebase-functions/params': { defineSecret: () => ({}), defineString: () => ({}) },
    'firebase-functions/v2/https': { HttpsError, onCall: (_, fn) => fn, onRequest: (_, fn) => fn },
    'firebase-functions/v2/scheduler': { onSchedule: (_, fn) => fn }
  };
  const exports = {};
  const source = fs.readFileSync(require.resolve('./index.js'), 'utf8');
  vm.runInNewContext(source, {
    exports, require: (name) => stubs[name] || require(name), URL, console
  });
  return { functions: exports, documents };
}

test('shared post views count distinct members, exclude the owner and are owner scoped', async () => {
  const { functions, documents } = createFunctions();
  documents.set('users/owner', { communityVisible: true });
  documents.set('communityProfiles/owner', { profileVisible: true, sharedPostIds: { g_post: true } });
  const view = (uid) => functions.recordGalleryView({ auth: { uid }, data: { ownerId: 'owner', postId: 'g_post' } });
  await view('first');
  await view('first');
  await view('second');
  await view('owner');
  const ownerCounts = await functions.getGalleryViewCounts({ auth: { uid: 'owner' }, data: { postIds: ['g_post'] } });
  const otherCounts = await functions.getGalleryViewCounts({ auth: { uid: 'other' }, data: { postIds: ['g_post'] } });
  assert.equal(ownerCounts.g_post, 2);
  assert.equal(otherCounts.g_post, 0);
  await functions.deleteGalleryViews({ auth: { uid: 'owner' }, data: { postId: 'g_post' } });
  assert.equal((await functions.getGalleryViewCounts({ auth: { uid: 'owner' }, data: { postIds: ['g_post'] } })).g_post, 0);
});

test('directory excludes profiles with a server moderation gate', async () => {
  const { functions, documents } = createFunctions();
  documents.set('users/owner', { communityVisible: true });
  documents.set('communityProfiles/owner', { profileVisible: true, username: 'Member' });
  assert.equal((await functions.listCommunityProfiles({ auth: { uid: 'visitor' } })).length, 1);
  documents.set('galleryModeration/owner', { active: 1 });
  assert.equal((await functions.listCommunityProfiles({ auth: { uid: 'visitor' } })).length, 0);
});

test('view recording requires authentication and a currently shared post', async () => {
  const { functions, documents } = createFunctions();
  const request = { auth: { uid: 'visitor' }, data: { ownerId: 'owner', postId: 's_old image.jpg' } };
  await assert.rejects(functions.recordGalleryView({ data: request.data }), { code: 'unauthenticated' });
  await assert.rejects(functions.recordGalleryView(request), { code: 'permission-denied' });
  documents.set('users/owner', { communityVisible: true });
  documents.set('communityProfiles/owner', { profileVisible: true, sharedPostIds: { 's_old image.jpg': true } });
  documents.set('galleryModeration/owner', { active: 1 });
  await assert.rejects(functions.recordGalleryView(request), { code: 'permission-denied' });
  documents.delete('galleryModeration/owner');
  await functions.recordGalleryView(request);
  documents.set('users/owner', { communityVisible: false });
  await assert.rejects(functions.recordGalleryView(request), { code: 'permission-denied' });
  await assert.rejects(functions.getGalleryViewCounts({ auth: { uid: 'owner' }, data: { postIds: ['../invalid'] } }), { code: 'invalid-argument' });
  assert.equal(documents.size, 3);
});

test('view deletion removes multiple batches without touching other posts', async () => {
  const { functions, documents } = createFunctions();
  for (let i = 0; i < 405; i++) documents.set('galleryEngagement/owner/posts/g_post/views/user' + i, {});
  documents.set('galleryEngagement/owner/posts/g_other/views/user', {});
  await functions.deleteGalleryViews({ auth: { uid: 'owner' }, data: { postId: 'g_post' } });
  assert.deepEqual([...documents.keys()], ['galleryEngagement/owner/posts/g_other/views/user']);
});
