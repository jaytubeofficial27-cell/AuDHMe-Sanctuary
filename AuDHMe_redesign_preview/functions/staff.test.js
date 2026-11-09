'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const createStaffFunctions = require('./staff');

function harness() {
  const docs = new Map();
  docs.set('staffRoles/4grgpBnKA9ROGhxJ0MoPn3yP3MV2', { role: 'owner' });
  const claims = new Map();
  let nextId = 0;
  const users = {
    'member@example.test': { uid: 'member', emailVerified: true, disabled: false },
    'unverified@example.test': { uid: 'unverified', emailVerified: false, disabled: false }
  };
  function snap(ref) {
    const data = docs.get(ref.path);
    return { id: ref.id, ref, exists: data !== undefined, data: () => data };
  }
  function collection(path) {
    return {
      doc: (id) => ref(path + '/' + (id || 'generated-' + (++nextId))),
      where: (field, op, value) => query(path, [[field, value]]),
      orderBy: () => query(path, []),
      limit: () => query(path, [])
    };
  }
  function query(path, filters) {
    return {
      where: (field, op, value) => query(path, filters.concat([[field, value]])),
      limit: () => query(path, filters),
      get: async () => querySnapshot(path, filters),
      path, filters
    };
  }
  function querySnapshot(path, filters) {
    const found = [...docs.keys()].filter((key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
      .map((key) => snap(ref(key))).filter((doc) => filters.every(([key, value]) => doc.data()[key] === value));
    return { docs: found, empty: found.length === 0 };
  }
  function ref(path) {
    return { path, id: path.split('/').pop(), get: async () => snap(ref(path)), collection: (name) => collection(path + '/' + name) };
  }
  const db = {
    collection,
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (target) => target.filters ? querySnapshot(target.path, target.filters) : snap(target),
        getAll: async (...refs) => refs.map(snap),
        create: (ref, data) => writes.push(() => { if (docs.has(ref.path)) throw Error('exists'); docs.set(ref.path, data); }),
        set: (ref, data) => writes.push(() => docs.set(ref.path, data)),
        update: (ref, data) => writes.push(() => { if (!docs.has(ref.path)) throw Error('missing'); docs.set(ref.path, { ...docs.get(ref.path), ...data }); }),
        delete: (ref) => writes.push(() => docs.delete(ref.path))
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    }
  };
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const firestore = function() {};
  firestore.FieldValue = { serverTimestamp: () => 'timestamp' };
  firestore.FieldPath = { documentId: () => '__name__' };
  const admin = {
    firestore,
    auth: () => ({ getUser: async (uid) => ({ uid, customClaims: claims.get(uid) || {} }),
      setCustomUserClaims: async (uid, values) => claims.set(uid, values),
      getUserByEmail: async (email) => {
      if (!users[email]) { const error = Error('not found'); error.code = 'auth/user-not-found'; throw error; }
      return users[email];
    } })
  };
  return { functions: createStaffFunctions(admin, db, HttpsError, (_, fn) => fn), docs, claims };
}

const owner = { uid: '4grgpBnKA9ROGhxJ0MoPn3yP3MV2', token: { role: 'owner' } };
const member = { uid: 'member' };

test('only the owner can invite and only verified registered accounts can be invited', async () => {
  const { functions, docs } = harness();
  const data = { email: 'member@example.test', role: 'moderator' };
  await assert.rejects(functions.inviteStaff({ auth: member, data }), { code: 'permission-denied' });
  await assert.rejects(functions.inviteStaff({ auth: owner, data: { ...data, email: 'unverified@example.test' } }), { code: 'failed-precondition' });
  await functions.inviteStaff({ auth: owner, data });
  assert.equal(docs.get('users/member/notifications/' + docs.get('staffInvitations/member').invitationId).read, false);
  await assert.rejects(functions.inviteStaff({ auth: owner, data }), { code: 'failed-precondition' });
  assert.equal(docs.has('staffRoles/member'), false);
});

test('invitation is bound to the recipient and acceptance creates a role and audit', async () => {
  const { functions, docs } = harness();
  await functions.inviteStaff({ auth: owner, data: { email: 'member@example.test', role: 'admin' } });
  const invitationId = docs.get('staffInvitations/member').invitationId;
  await assert.rejects(functions.respondStaffInvitation({ auth: { uid: 'other' }, data: { invitationId, accept: true } }), { code: 'failed-precondition' });
  await functions.respondStaffInvitation({ auth: member, data: { invitationId, accept: true } });
  assert.equal(docs.get('staffRoles/member').role, 'admin');
  assert.equal(docs.get('users/member/notifications/' + invitationId).status, 'accepted');
  assert.equal([...docs.entries()].filter(([key]) => key.startsWith('adminAudit/')).length, 2);
  await assert.rejects(functions.respondStaffInvitation({ auth: member, data: { invitationId, accept: true } }), { code: 'failed-precondition' });
});

test('revocation removes current role and invalidates pending invitations', async () => {
  const { functions, docs } = harness();
  await functions.inviteStaff({ auth: owner, data: { email: 'member@example.test', role: 'admin' } });
  const oldInvitationId = docs.get('staffInvitations/member').invitationId;
  await assert.rejects(functions.revokeStaff({ auth: member, data: { uid: 'member' } }), { code: 'permission-denied' });
  await functions.revokeStaff({ auth: owner, data: { uid: 'member' } });
  await assert.rejects(functions.respondStaffInvitation({ auth: member, data: { invitationId: oldInvitationId, accept: true } }), { code: 'failed-precondition' });
  assert.equal(docs.get('users/member/notifications/' + oldInvitationId).status, 'revoked');
  await functions.inviteStaff({ auth: owner, data: { email: 'member@example.test', role: 'moderator' } });
  const pendingId = docs.get('staffInvitations/member').invitationId;
  await assert.rejects(functions.respondStaffInvitation({ auth: member, data: { invitationId: oldInvitationId, accept: true } }), { code: 'failed-precondition' });
  await functions.respondStaffInvitation({ auth: member, data: { invitationId: pendingId, accept: true } });
  await functions.revokeStaff({ auth: owner, data: { uid: 'member' } });
  assert.equal((await functions.getStaffRole({ auth: member })).role, null);
});

test('profile audit requires current staff role and moderators see only currently shared profiles', async () => {
  const { functions, docs } = harness();
  docs.set('users/private', { username: 'Private', communityVisible: false, neurotypes: ['Private data'] });
  docs.set('users/shared', { username: 'Shared', communityVisible: true });
  docs.set('communityProfiles/private', { username: 'Old projection', visible: true, profileVisible: true });
  docs.set('communityProfiles/shared', { username: 'Shared', visible: true, profileVisible: true });
  await assert.rejects(functions.listModerationProfiles({ auth: member, data: {} }), { code: 'permission-denied' });
  docs.set('staffRoles/member', { role: 'moderator' });
  const shared = await functions.listModerationProfiles({ auth: { ...member, token: { role: 'moderator' } }, data: {} });
  assert.deepEqual(shared.profiles.map((profile) => profile.uid), ['shared']);
  docs.set('staffRoles/member', { role: 'admin' });
  const all = await functions.listModerationProfiles({ auth: { ...member, token: { role: 'admin' } }, data: {} });
  assert.deepEqual(all.profiles.map((profile) => profile.uid), ['private', 'shared']);
  assert.equal([...docs.keys()].filter((path) => path.startsWith('adminAudit/')).length, 2);
  docs.delete('staffRoles/member');
  await assert.rejects(functions.listModerationProfiles({ auth: member, data: {} }), { code: 'permission-denied' });
  await assert.rejects(functions.listAdminAudit({ auth: member }), { code: 'permission-denied' });
});

test('revocation notice is private to its recipient and can be marked read', async () => {
  const { functions, docs } = harness();
  await functions.inviteStaff({ auth: owner, data: { email: 'member@example.test', role: 'admin' } });
  const invitationId = docs.get('staffInvitations/member').invitationId;
  await assert.rejects(functions.markStaffNotificationRead({ auth: member, data: { notificationId: invitationId } }), { code: 'failed-precondition' });
  await functions.revokeStaff({ auth: owner, data: { uid: 'member' } });
  const noticePath = [...docs.entries()].find(([path, value]) => path.startsWith('users/member/notifications/') && value.type === 'staff-revoked')[0];
  const noticeId = noticePath.split('/').pop();
  await assert.rejects(functions.markStaffNotificationRead({ auth: { uid: 'other' }, data: { notificationId: noticeId } }), { code: 'not-found' });
  await functions.markStaffNotificationRead({ auth: member, data: { notificationId: noticeId } });
  assert.equal(docs.get(noticePath).read, true);
});

test('diagnostics require current staff access and distinguish unverified checks', async () => {
  const { functions, docs } = harness();
  await assert.rejects(functions.staffDiagnostics({ auth: member }), { code: 'permission-denied' });
  docs.set('staffRoles/member', { role: 'moderator' });
  const status = await functions.staffDiagnostics({ auth: { ...member, token: { role: 'moderator' } } });
  assert.match(status.firestore, /read succeeded/);
  assert.match(status.securityRules, /Not verified/);
  assert.match(status.storage, /not available/);
  docs.delete('staffRoles/member');
  await assert.rejects(functions.staffDiagnostics({ auth: member }), { code: 'permission-denied' });
});

test('claim sync preserves unrelated claims and privileged calls require both current record and claim', async () => {
  const { functions, docs, claims } = harness();
  docs.set('staffRoles/member', { role: 'admin' });
  claims.set('member', { unrelated: true });
  assert.equal((await functions.syncMyStaffClaim({ auth: member })).role, 'admin');
  assert.deepEqual(claims.get('member'), { unrelated: true, role: 'admin' });
  await assert.rejects(functions.staffDiagnostics({ auth: member }), { code: 'permission-denied' });
  await functions.staffDiagnostics({ auth: { ...member, token: { role: 'admin' } } });
  docs.set('staffRoles/member', { role: 'moderator' });
  await assert.rejects(functions.staffDiagnostics({ auth: { ...member, token: { role: 'admin' } } }), { code: 'permission-denied' });
  await functions.syncMyStaffClaim({ auth: member });
  assert.equal(claims.get('member').role, 'moderator');
  docs.delete('staffRoles/member');
  await assert.rejects(functions.staffDiagnostics({ auth: { ...member, token: { role: 'moderator' } } }), { code: 'permission-denied' });
  await functions.syncMyStaffClaim({ auth: member });
  assert.deepEqual(claims.get('member'), { unrelated: true });
});

test('owner access requires both the fixed identity and matching server role', async () => {
  const { functions, docs } = harness();
  await assert.rejects(functions.listStaff({ auth: { uid: owner.uid } }), { code: 'permission-denied' });
  docs.set('staffRoles/other', { role: 'owner' });
  await assert.rejects(functions.listModerationProfiles({ auth: { uid: 'other', token: { role: 'owner' } } }), { code: 'permission-denied' });
  docs.delete('staffRoles/' + owner.uid);
  await assert.rejects(functions.listStaff({ auth: owner }), { code: 'permission-denied' });
  await functions.syncMyStaffClaim({ auth: { uid: owner.uid } });
  assert.equal(docs.get('staffRoles/' + owner.uid).role, 'owner');
});

test('only the owner can change an active role and changes are audited and notified', async () => {
  const { functions, docs } = harness();
  docs.set('staffRoles/member', { role: 'admin' });
  await assert.rejects(functions.changeStaffRole({ auth: member, data: { uid: 'member', role: 'moderator' } }), { code: 'permission-denied' });
  await functions.changeStaffRole({ auth: owner, data: { uid: 'member', role: 'moderator' } });
  assert.equal((await functions.getStaffRole({ auth: member })).role, 'moderator');
  assert.ok([...docs.entries()].some(([path, value]) => path.startsWith('adminAudit/') && value.action === 'staff.role_changed'));
  assert.ok([...docs.entries()].some(([path, value]) => path.startsWith('users/member/notifications/') && value.type === 'staff-role-changed' && value.read === false));
  await assert.rejects(functions.changeStaffRole({ auth: owner, data: { uid: owner.uid, role: 'admin' } }), { code: 'invalid-argument' });
});

test('only verified owner and admins can update the per-visitor atmosphere policy', async () => {
  const { functions, docs } = harness();
  const policy = { localTime: false, calendarSeason: true, calendarHoliday: false, liveWeather: false };
  await assert.rejects(functions.updateSiteAtmospherePolicy({ auth: member, data: { policy } }), { code: 'permission-denied' });
  docs.set('staffRoles/member', { role: 'moderator' });
  await assert.rejects(functions.updateSiteAtmospherePolicy({
    auth: { ...member, token: { role: 'moderator' } }, data: { policy }
  }), { code: 'permission-denied' });
  docs.set('staffRoles/member', { role: 'admin' });
  await assert.rejects(functions.updateSiteAtmospherePolicy({
    auth: { ...member, token: { role: 'moderator' } }, data: { policy }
  }), { code: 'permission-denied' });
  const result = await functions.updateSiteAtmospherePolicy({
    auth: { ...member, token: { role: 'admin' } }, data: { policy }
  });
  assert.deepEqual(result.policy, policy);
  assert.deepEqual(
    Object.fromEntries(Object.entries(docs.get('siteSettings/atmosphere')).filter(([key]) =>
      ['localTime', 'calendarSeason', 'calendarHoliday', 'liveWeather'].includes(key))),
    policy
  );
  assert.ok([...docs.entries()].some(([path, value]) =>
    path.startsWith('adminAudit/') && value.action === 'site.atmosphere_updated'
  ));
  await assert.rejects(functions.updateSiteAtmospherePolicy({
    auth: owner, data: { policy: { ...policy, unknown: true } }
  }), { code: 'invalid-argument' });
});
