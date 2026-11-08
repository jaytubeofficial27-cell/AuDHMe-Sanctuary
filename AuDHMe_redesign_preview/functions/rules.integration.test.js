'use strict';

const { before, after, beforeEach, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, updateDoc } = require('firebase/firestore');
const { ref, getBytes, uploadBytes, updateMetadata, deleteObject } = require('firebase/storage');

const projectId = 'demo-audh-me';
let env;

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error('Run using npm run test:rules so both Firebase emulators are available.');
  }
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
    storage: { rules: fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8') }
  });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/member'), {
      uid: 'member', username: 'Member', bio: '', neurotypes: [], links: [],
      interestMedia: [], communityVisible: false
    });
    await setDoc(doc(db, 'staffRoles/admin'), { role: 'admin' });
    await setDoc(doc(db, 'staffRoles/moderator'), { role: 'moderator' });
    await setDoc(doc(db, 'users/member/notifications/notice'), { read: false, type: 'staff-revoked' });
    await setDoc(doc(db, 'adminAudit/log'), { action: 'staff.revoked', actor: 'owner' });
  });
});

test('private profiles remain inaccessible to ordinary members and moderators', async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext('member').firestore(), 'users/member')));
  for (const [uid, role] of [['visitor', null], ['moderator', 'moderator']]) {
    const db = env.authenticatedContext(uid, role ? { role } : {}).firestore();
    await assertFails(getDoc(doc(db, 'users/member')));
  }
});

test('staff role records, audit logs, and inbox writes remain server-only', async () => {
  const member = env.authenticatedContext('member').firestore();
  const admin = env.authenticatedContext('admin', { role: 'admin' }).firestore();
  const owner = env.authenticatedContext('owner', { role: 'owner' }).firestore();
  await assertSucceeds(getDoc(doc(member, 'users/member/notifications/notice')));
  await assertFails(getDoc(doc(admin, 'users/member/notifications/notice')));
  await assertFails(setDoc(doc(member, 'users/member/notifications/forged'), { type: 'staff-invitation' }));
  await assertFails(updateDoc(doc(member, 'users/member/notifications/notice'), { read: true }));
  await assertFails(setDoc(doc(admin, 'staffRoles/admin'), { role: 'owner' }));
  await assertFails(setDoc(doc(owner, 'staffRoles/member'), { role: 'admin' }));
  await assertFails(deleteDoc(doc(owner, 'staffRoles/admin')));
  await assertFails(getDoc(doc(admin, 'adminAudit/log')));
  await assertFails(setDoc(doc(admin, 'adminAudit/forged'), { action: 'approved' }));
});

test('direct deletion and undeveloped moderation or cleanup writes fail closed', async () => {
  for (const [uid, role] of [['member', null], ['admin', 'admin'], ['moderator', 'moderator']]) {
    const db = env.authenticatedContext(uid, role ? { role } : {}).firestore();
    await assertFails(deleteDoc(doc(db, 'users/member')));
    await assertFails(setDoc(doc(db, 'moderationQueue/item'), { status: 'quarantined' }));
    await assertFails(setDoc(doc(db, 'ghostCleanup/member'), { delete: true }));
    await assertFails(setDoc(doc(db, 'globalConfig/features'), { maintenance: true }));
  }
});

test('private gallery files cannot be read by another member or moderator', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), 'users/member/gallery/item.png'), new Uint8Array([1, 2, 3]), {
      contentType: 'image/png', customMetadata: { visibility: 'private' }
    });
  });
  await assertSucceeds(getBytes(ref(env.authenticatedContext('member').storage(), 'users/member/gallery/item.png')));
  await assertFails(getBytes(ref(env.authenticatedContext('moderator', { role: 'moderator' }).storage(), 'users/member/gallery/item.png')));
  await assertFails(getBytes(ref(env.authenticatedContext('visitor').storage(), 'users/member/gallery/item.png')));
});

test('server moderation gates shared profiles, post engagement and the original object', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await updateDoc(doc(db, 'users/member'), { communityVisible: true });
    await setDoc(doc(db, 'communityProfiles/member'), {
      uid: 'member', visible: true, profileVisible: true, username: 'Member',
      interestMedia: [{ path: 'users/member/gallery/item.png', visibility: 'community' }],
      sharedPostIds: { 's_item.png': true }
    });
    await uploadBytes(ref(context.storage(), 'users/member/gallery/item.png'), new Uint8Array([1, 2, 3]), {
      contentType: 'image/png', customMetadata: { visibility: 'community' }
    });
  });
  const memberDb = env.authenticatedContext('member').firestore();
  const visitorDb = env.authenticatedContext('visitor').firestore();
  const memberStorage = env.authenticatedContext('member').storage();
  const visitorStorage = env.authenticatedContext('visitor').storage();
  const item = ref(memberStorage, 'users/member/gallery/item.png');
  await assertSucceeds(getDoc(doc(visitorDb, 'communityProfiles/member')));
  await assertSucceeds(getBytes(ref(visitorStorage, item.fullPath)));
  await assertFails(setDoc(doc(memberDb, 'galleryModeration/member'), { active: 0 }));
  await assertFails(setDoc(doc(memberDb, 'galleryModeration/member/items/gallery~item.png'), { status: 'removed' }));
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'galleryModeration/member'), { active: 1 });
    await setDoc(doc(db, 'galleryModeration/member/items/gallery~item.png'), { status: 'quarantined' });
  });
  await assertFails(getDoc(doc(visitorDb, 'communityProfiles/member')));
  await assertFails(getBytes(ref(visitorStorage, item.fullPath)));
  await assertFails(getBytes(item));
  await assertFails(updateMetadata(item, { customMetadata: { visibility: 'community' } }));
  await assertFails(deleteObject(item));
  await assertFails(uploadBytes(item, new Uint8Array([4, 5, 6]), {
    contentType: 'image/png', customMetadata: { visibility: 'community' }
  }));
  await assertFails(setDoc(doc(visitorDb, 'galleryEngagement/member/posts/s_item.png/likes/visitor'), { uid: 'visitor' }));
  await assertSucceeds(updateDoc(doc(memberDb, 'communityProfiles/member'), { profileVisible: true }));
  await assertFails(getDoc(doc(visitorDb, 'communityProfiles/member')));
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await deleteDoc(doc(db, 'galleryModeration/member/items/gallery~item.png'));
    await deleteDoc(doc(db, 'galleryModeration/member'));
  });
  await assertSucceeds(getDoc(doc(visitorDb, 'communityProfiles/member')));
  await assertSucceeds(getBytes(ref(visitorStorage, item.fullPath)));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'galleryModeration/member/items/gallery~item.png'), { status: 'removed' });
  });
  await assertFails(getBytes(ref(visitorStorage, item.fullPath)));
  await assertFails(deleteObject(item));
});
