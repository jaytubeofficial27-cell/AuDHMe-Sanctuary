'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
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
  const server = admin.initializeApp({ projectId }, 'staff-integration');
  const client = initializeApp({ projectId, apiKey: 'emulator-only' }, 'staff-integration');
  const auth = getAuth(client);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const api = createStaffFunctions({ auth: () => server.auth(), firestore: admin.firestore }, server.firestore(), HttpsError, (_, fn) => fn);
  async function signIn(uid) {
    await signInWithCustomToken(auth, await server.auth().createCustomToken(uid));
  }
  async function request(refresh = false) {
    const token = await auth.currentUser.getIdToken(refresh);
    const decoded = await server.auth().verifyIdToken(token);
    return { auth: { uid: decoded.uid, token: decoded } };
  }
  try {
    await server.auth().createUser({ uid: ownerUid });
    await server.auth().createUser({ uid: 'member', email: 'member@example.test', emailVerified: true });
    await signIn(ownerUid);
    await assert.rejects(api.listStaff(await request()), { code: 'permission-denied' });
    await api.syncMyStaffClaim(await request());
    const ownerRequest = await request(true);
    assert.equal(ownerRequest.auth.token.role, 'owner');
    await api.inviteStaff({ ...ownerRequest, data: { email: 'member@example.test', role: 'admin' } });
    const invitation = await server.firestore().collection('staffInvitations').doc('member').get();
    await signIn('member');
    await api.respondStaffInvitation({ ...await request(), data: { invitationId: invitation.data().invitationId, accept: true } });
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
    await server.delete();
  }
});
