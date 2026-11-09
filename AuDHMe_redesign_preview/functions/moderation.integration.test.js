'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { HttpsError } = require('firebase-functions/v2/https');
const createModerationFunctions = require('./moderation');

const projectId = 'demo-audh-me';

test('emulator quarantine, restore, and retention cleanup use real Firestore and Storage SDKs', async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error('Run using npm run test:rules so Firestore and Storage emulators are available.');
  }
  const app = initializeApp({
    projectId,
    storageBucket: projectId + '.appspot.com'
  }, 'moderation-integration');
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket();
  const api = createModerationFunctions(
    db, bucket, { FieldValue, Timestamp }, HttpsError, (_, handler) => handler, (_, handler) => handler
  );
  const uid = 'moderation-member';
  const staffUid = 'moderation-admin';
  const itemPath = 'users/' + uid + '/gallery/item.png';
  const itemRef = db.collection('galleryModeration').doc(uid).collection('items').doc('gallery~item.png');

  try {
    await db.collection('staffRoles').doc(staffUid).set({ role: 'admin' });
    await db.collection('users').doc(uid).set({
      uid, username: 'Moderation test', communityVisible: true,
      interestMedia: [{ path: itemPath, name: 'Image', type: 'image/png', visibility: 'community' }]
    });
    await db.collection('communityProfiles').doc(uid).set({
      uid, visible: true, profileVisible: true, username: 'Moderation test',
      interestMedia: [{ path: itemPath, name: 'Image', type: 'image/png', visibility: 'community' }],
      sharedPostIds: { 's_item.png': true }
    });
    await bucket.file(itemPath).save(Buffer.from('moderation integration data'), {
      metadata: {
        contentType: 'image/png',
        metadata: { visibility: 'community', firebaseStorageDownloadTokens: 'integration-token' }
      }
    });
    const request = { auth: { uid: staffUid, token: { role: 'admin' } } };
    await api.quarantineGalleryItem({
      ...request, data: { uid, path: itemPath, reason: 'Integration test quarantine' }
    });
    let record = (await itemRef.get()).data();
    assert.equal(record.status, 'quarantined');
    assert.equal((await bucket.file(itemPath).exists())[0], false);
    const [quarantineMetadata] = await bucket.file(record.quarantinePath).getMetadata();
    assert.ok(!quarantineMetadata.metadata || !quarantineMetadata.metadata.firebaseStorageDownloadTokens);

    await api.restoreGalleryItem({ ...request, data: { uid, id: itemRef.id } });
    assert.equal((await itemRef.get()).exists, false);
    assert.equal((await db.collection('galleryModeration').doc(uid).get()).exists, false);
    assert.equal((await bucket.file(itemPath).exists())[0], true);
    const [restoredMetadata] = await bucket.file(itemPath).getMetadata();
    assert.ok(!restoredMetadata.metadata || !restoredMetadata.metadata.firebaseStorageDownloadTokens);

    const expiredPath = 'users/' + uid + '/gallery/expired.png';
    const expiredArchive = 'moderationQuarantine/' + uid + '/expired.png-private-copy';
    const expiredRef = db.collection('galleryModeration').doc(uid).collection('items').doc('gallery~expired.png');
    await db.collection('users').doc(uid).update({
      interestMedia: [
        { path: itemPath, name: 'Image', type: 'image/png', visibility: 'community' },
        { path: expiredPath, name: 'Expired image', type: 'image/png', visibility: 'community' }
      ]
    });
    await db.collection('communityProfiles').doc(uid).update({
      interestMedia: [
        { path: itemPath, name: 'Image', type: 'image/png', visibility: 'community' },
        { path: expiredPath, name: 'Expired image', type: 'image/png', visibility: 'community' }
      ],
      sharedPostIds: { 's_item.png': true, 's_expired.png': true }
    });
    await db.collection('galleryModeration').doc(uid).set({ activeCount: 1 });
    await expiredRef.set({
      ownerUid: uid, path: expiredPath, quarantinePath: expiredArchive,
      postId: 's_expired.png', status: 'quarantined', visibility: 'community',
      expiresAt: Timestamp.fromMillis(Date.now() - 1000)
    });
    await bucket.file(expiredPath).save(Buffer.from('expired source'), { metadata: { contentType: 'image/png' } });
    await bucket.file(expiredArchive).save(Buffer.from('expired quarantine'), { metadata: { contentType: 'image/png' } });
    await db.collection('galleryEngagement').doc(uid).collection('posts').doc('s_expired.png')
      .collection('comments').doc('comment').set({ text: 'remove with expired media' });

    const cleanup = await api.expireQuarantinedGalleryItems();
    assert.equal(cleanup.removed, 1);
    assert.equal((await bucket.file(expiredPath).exists())[0], false);
    assert.equal((await bucket.file(expiredArchive).exists())[0], false);
    assert.equal((await expiredRef.get()).exists, false);
    assert.equal((await db.collection('galleryEngagement').doc(uid).collection('posts').doc('s_expired.png')
      .collection('comments').doc('comment').get()).exists, false);
    const user = (await db.collection('users').doc(uid).get()).data();
    assert.deepEqual(user.interestMedia.map((item) => item.path), [itemPath]);
  } finally {
    await bucket.deleteFiles({ prefix: 'users/' + uid + '/' }).catch(() => {});
    await bucket.deleteFiles({ prefix: 'moderationQuarantine/' + uid + '/' }).catch(() => {});
    await db.recursiveDelete(db.collection('galleryModeration').doc(uid)).catch(() => {});
    await db.recursiveDelete(db.collection('galleryEngagement').doc(uid)).catch(() => {});
    await db.collection('staffRoles').doc(staffUid).delete().catch(() => {});
    await db.collection('users').doc(uid).delete().catch(() => {});
    await db.collection('communityProfiles').doc(uid).delete().catch(() => {});
    await deleteApp(app);
  }
});
