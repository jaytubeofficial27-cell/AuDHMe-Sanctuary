'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { getFirestore, FieldPath, FieldValue } = require('firebase-admin/firestore');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCustomToken, signOut } = require('firebase/auth');
const { HttpsError } = require('firebase-functions/v2/https');
const createStaffFunctions = require('./staff');

const projectId = 'demo-audh-me';
const ownerUid = '4grgpBnKA9ROGhxJ0MoPn3yP3MV2';

test('real emulator claims and server roles must match for staff access', async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Run using npm run test:rules with Auth and Firestore emulators.');
  }
  const server = initializeAdminApp({ projectId }, 'staff-integration');
  const serverAuth = getAdminAuth(server);
  const db = getFirestore(server);
  const client = initializeApp({ projectId, apiKey: 'emulator-only' }, 'staff-integration');
  const auth = getAuth(client);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const api = createStaffFunctions(serverAuth, db, { FieldPath, FieldValue }, HttpsError, (_, fn) => fn);
  async function signIn(uid) {
    await signInWithCustomToken(auth, await serverAuth.createCustomToken(uid));
  }
  async function request(refresh = false) {
    const token = await auth.currentUser.getIdToken(refresh);
    const decoded = await serverAuth.verifyIdToken(token);
    return { auth: { uid: decoded.uid, token: decoded } };
  }
  try {
    await serverAuth.createUser({ uid: ownerUid, displayName: 'Owner Name' });
    await serverAuth.createUser({ uid: 'member', email: 'member@example.test', emailVerified: true, displayName: 'Member Name' });
    await signIn(ownerUid);
    await assert.rejects(api.listStaff(await request()), { code: 'permission-denied' });
    await api.syncMyStaffClaim(await request());
    const ownerRequest = await request(true);
    assert.equal(ownerRequest.auth.token.role, 'owner');
    await db.collection('users').doc(ownerUid).set({ username: 'Profile Owner Name' });
    await db.collection('users').doc('member').set({ username: 'Profile Member Name' });
    await api.inviteStaff({ ...ownerRequest, data: { email: 'member@example.test', role: 'admin' } });
    const invitation = await db.collection('staffInvitations').doc('member').get();
    await signIn('member');
    await api.respondStaffInvitation({ ...await request(), data: { invitationId: invitation.data().invitationId, accept: true } });
    const staffList = await api.listStaff(ownerRequest);
    assert.equal(staffList.members.find(({ uid }) => uid === ownerUid).name, 'Profile Owner Name');
    assert.equal(staffList.members.find(({ uid }) => uid === 'member').name, 'Profile Member Name');
    await assert.rejects(api.staffDiagnostics(await request()), { code: 'permission-denied' });
    await api.syncMyStaffClaim(await request());
    const adminRequest = await request(true);
    assert.equal(adminRequest.auth.token.role, 'admin');
    await api.staffDiagnostics(adminRequest);
    await signIn(ownerUid);
    const ownerRefreshed = await request(true);
    await api.changeStaffRole({ ...ownerRefreshed, data: { uid: 'member', role: 'moderator' } });
    await assert.rejects(api.staffDiagnostics(adminRequest), { code: 'permission-denied' });
    await signIn('member');
    await api.syncMyStaffClaim(await request());
    const moderatorRequest = await request(true);
    assert.equal(moderatorRequest.auth.token.role, 'moderator');
    await api.staffDiagnostics(moderatorRequest);
    await assert.rejects(api.changeStaffRole({ ...moderatorRequest, data: { uid: 'member', role: 'admin' } }), { code: 'permission-denied' });
    await signIn(ownerUid);
    await api.revokeStaff({ ...await request(true), data: { uid: 'member' } });
    await assert.rejects(api.staffDiagnostics(moderatorRequest), { code: 'permission-denied' });
    await signIn('member');
    await api.syncMyStaffClaim(await request());
    const revokedRequest = await request(true);
    assert.equal(revokedRequest.auth.token.role, undefined);
    await assert.rejects(api.staffDiagnostics(revokedRequest), { code: 'permission-denied' });
  } finally {
    await signOut(auth);
    await deleteApp(client);
    await deleteAdminApp(server);
  }
});
