'use strict';

const { randomUUID } = require('node:crypto');
const OWNER_UID = '4grgpBnKA9ROGhxJ0MoPn3yP3MV2';
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 365;
const ACTIVE_STATES = ['quarantining', 'quarantined', 'restoring', 'expiring'];

module.exports = function createModerationFunctions(db, bucket, firestore, HttpsError, onCall, onSchedule) {
  const options = { region: 'europe-west2', maxInstances: 5 };
  const timestamp = () => firestore.FieldValue.serverTimestamp();

  function requireUser(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue.');
    return request.auth.uid;
  }

  function validId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 128 &&
      !id.includes('/') && id !== '.' && id !== '..';
  }

  function parseGalleryPath(uid, path) {
    if (!validId(uid) || typeof path !== 'string') return null;
    const match = /^users\/([^/]+)\/(gallery|interests)\/([^/]+)$/.exec(path);
    if (!match || match[1] !== uid) return null;
    return { folder: match[2], fileName: match[3], itemId: match[2] + '~' + match[3] };
  }

  function postId(item, path) {
    return typeof item.groupId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(item.groupId)
      ? 'g_' + item.groupId
      : typeof path === 'string' ? 's_' + path.slice(path.lastIndexOf('/') + 1) : '';
  }

  function audit(transaction, action, actor, target, details) {
    transaction.create(db.collection('adminAudit').doc(), {
      action, actor, target, details, createdAt: timestamp()
    });
  }

  async function copyWithoutDownloadToken(source, destination) {
    const [sourceMetadata] = await source.getMetadata();
    const customMetadata = Object.assign({}, sourceMetadata.metadata || {});
    delete customMetadata.firebaseStorageDownloadTokens;
    await source.copy(destination, {
      cacheControl: sourceMetadata.cacheControl,
      contentDisposition: sourceMetadata.contentDisposition,
      contentEncoding: sourceMetadata.contentEncoding,
      contentType: sourceMetadata.contentType,
      metadata: customMetadata
    });
    const [copiedMetadata] = await destination.getMetadata();
    if (copiedMetadata.metadata && copiedMetadata.metadata.firebaseStorageDownloadTokens) {
      throw new Error('The private copy retained a Firebase download token.');
    }
  }

  async function requireStaff(transaction, request) {
    const uid = requireUser(request);
    const roleSnapshot = await transaction.get(db.collection('staffRoles').doc(uid));
    const role = roleSnapshot.exists && roleSnapshot.data().role;
    if (!request.auth.token || request.auth.token.role !== role ||
        (role === 'owner' && uid !== OWNER_UID) ||
        !['owner', 'admin', 'moderator'].includes(role)) {
      throw new HttpsError('permission-denied', 'Verified staff access is required.');
    }
    return { uid, role };
  }

  function canReview(role, profile, projection, item, sharedOnly) {
    if (role !== 'moderator') return true;
    return sharedOnly && profile.communityVisible === true &&
      projection && projection.visible === true && projection.profileVisible === true &&
      item.visibility !== 'private' && item.archived !== true;
  }

  async function quarantine(request) {
    const actor = requireUser(request);
    const data = request.data || {};
    const targetUid = data.uid;
    const path = data.path;
    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    const parsed = parseGalleryPath(targetUid, path);
    if (!parsed || reason.length === 0 || reason.length > 500) {
      throw new HttpsError('invalid-argument', 'Choose a valid gallery item and enter a reason (up to 500 characters).');
    }

    const profileRef = db.collection('users').doc(targetUid);
    const projectionRef = db.collection('communityProfiles').doc(targetUid);
    const parentRef = db.collection('galleryModeration').doc(targetUid);
    const itemRef = parentRef.collection('items').doc(parsed.itemId);
    const sourceFile = bucket.file(path);
    const quarantinePath = 'moderationQuarantine/' + targetUid + '/' + parsed.itemId + '-' + randomUUID();
    const now = firestore.Timestamp.now();
    const expiresAt = firestore.Timestamp.fromMillis(now.toMillis() + RETENTION_DAYS * DAY_MS);

    const state = await db.runTransaction(async (transaction) => {
      const { uid, role } = await requireStaff(transaction, request);
      const [profileSnapshot, projectionSnapshot, parentSnapshot, itemSnapshot] = await transaction.getAll(
        profileRef, projectionRef, parentRef, itemRef
      );
      if (!profileSnapshot.exists) throw new HttpsError('not-found', 'The member profile no longer exists.');
      const profile = profileSnapshot.data();
      const projection = projectionSnapshot.exists ? projectionSnapshot.data() : null;
      const items = Array.isArray(profile.interestMedia) ? profile.interestMedia : [];
      const item = items.find((entry) => entry && entry.path === path);
      if (!item) throw new HttpsError('not-found', 'The gallery item is no longer in this profile.');
      if (!canReview(role, profile, projection, item, item.visibility !== 'private')) {
        throw new HttpsError('permission-denied', 'Moderators may only quarantine items currently shared with members.');
      }

      if (itemSnapshot.exists && itemSnapshot.data().status === 'quarantined') {
        throw new HttpsError('failed-precondition', 'This item is already quarantined.');
      }
      if (itemSnapshot.exists && ['restoring', 'expiring', 'deleted'].includes(itemSnapshot.data().status)) {
        throw new HttpsError('failed-precondition', 'This item is currently unavailable for quarantine.');
      }

      const retrying = itemSnapshot.exists && itemSnapshot.data().status === 'quarantining';
      const archive = retrying ? itemSnapshot.data().quarantinePath : quarantinePath;
      if (!retrying) {
        const activeCount = parentSnapshot.exists && Number.isInteger(parentSnapshot.data().activeCount)
          ? parentSnapshot.data().activeCount : 0;
        const record = {
          ownerUid: targetUid, path, quarantinePath: archive, itemId: parsed.itemId,
          name: typeof item.name === 'string' ? item.name.slice(0, 100) : '',
          type: typeof item.type === 'string' ? item.type.slice(0, 100) : '',
          visibility: item.visibility === 'private' ? 'private' : 'community',
          postId: postId(item, path), reason, status: 'quarantining', requestedBy: uid,
          createdAt: now, expiresAt, updatedAt: timestamp()
        };
        if (itemSnapshot.exists) transaction.set(itemRef, record);
        else transaction.create(itemRef, record);
        transaction.set(parentRef, {
          activeCount: activeCount + 1,
          updatedAt: timestamp()
        });
        audit(transaction, 'gallery.quarantine_started', uid, targetUid, { itemId: parsed.itemId, reason });
      } else if (!parentSnapshot.exists) {
        transaction.set(parentRef, { activeCount: 1, updatedAt: timestamp() });
      }
      return { quarantinePath: archive, retrying };
    });

    try {
      const archiveFile = bucket.file(state.quarantinePath);
      const [sourceExists] = await sourceFile.exists();
      const [archiveExists] = await archiveFile.exists();
      if (sourceExists) {
        await copyWithoutDownloadToken(sourceFile, archiveFile);
        try {
          await sourceFile.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
        } catch (error) {
          console.warn('Gallery source token could not be revoked before deletion:', error.code || error.message, path);
        }
        await sourceFile.delete({ ignoreNotFound: true });
      } else if (!archiveExists) {
        throw new Error('Neither the original nor the private quarantine copy exists.');
      }
    } catch (error) {
      console.error('Gallery quarantine did not complete securely:', error.code || error.message, path);
      throw new HttpsError('unavailable', 'Quarantine did not finish. The item remains gated, but an existing download link may still work; retry immediately or contact the site owner.');
    }

    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(itemRef);
      if (!current.exists || current.data().status !== 'quarantining') {
        throw new HttpsError('failed-precondition', 'The quarantine state changed before it could be completed.');
      }
      transaction.update(itemRef, { status: 'quarantined', updatedAt: timestamp() });
      audit(transaction, 'gallery.quarantined', actor, targetUid, { itemId: parsed.itemId });
    });
    return { quarantined: true, expiresAt: expiresAt.toMillis() };
  }

  async function listQuarantine(request) {
    return db.runTransaction(async (transaction) => {
      const { uid, role } = await requireStaff(transaction, request);
      const query = db.collectionGroup('items').where('status', 'in', ['quarantining', 'quarantined', 'restoring']).limit(100);
      const snapshot = await transaction.get(query);
      const records = snapshot.docs.map((doc) => ({ ref: doc.ref, data: doc.data() }));
      const ownerIds = [...new Set(records.map((record) => record.data.ownerUid).filter(validId))];
      const owners = ownerIds.length
        ? await transaction.getAll(...ownerIds.flatMap((ownerId) => [
          db.collection('users').doc(ownerId), db.collection('communityProfiles').doc(ownerId)
        ]))
        : [];
      const ownerData = new Map();
      ownerIds.forEach((ownerId, index) => {
        ownerData.set(ownerId, {
          profile: owners[index * 2].exists ? owners[index * 2].data() : null,
          projection: owners[index * 2 + 1].exists ? owners[index * 2 + 1].data() : null
        });
      });
      const items = records.flatMap(({ ref, data }) => {
        const owner = ownerData.get(data.ownerUid);
        if (!owner || !owner.profile || !canReview(role, owner.profile, owner.projection,
            { visibility: data.visibility }, data.visibility === 'community')) return [];
        if (data.expiresAt && data.expiresAt.toMillis() <= firestore.Timestamp.now().toMillis()) return [];
        return [{
          id: ref.id, uid: data.ownerUid, path: data.path, name: data.name || '',
          reason: data.reason || '', visibility: data.visibility,
          status: data.status,
          expiresAt: data.expiresAt ? data.expiresAt.toMillis() : null
        }];
      });
      audit(transaction, 'gallery.quarantine_queue_viewed', uid, 'gallery', { count: items.length });
      return { items };
    });
  }

  async function restore(request) {
    const actor = requireUser(request);
    const id = request.data && request.data.id;
    const targetUid = request.data && request.data.uid;
    if (!validId(targetUid) || typeof id !== 'string' || id.length > 1200 || id.includes('/')) {
      throw new HttpsError('invalid-argument', 'Choose a valid quarantined item.');
    }
    const parentRef = db.collection('galleryModeration').doc(targetUid);
    const itemRef = parentRef.collection('items').doc(id);
    const profileRef = db.collection('users').doc(targetUid);
    const projectionRef = db.collection('communityProfiles').doc(targetUid);

    const state = await db.runTransaction(async (transaction) => {
      const { uid, role } = await requireStaff(transaction, request);
      const [itemSnapshot, profileSnapshot, projectionSnapshot] = await transaction.getAll(
        itemRef, profileRef, projectionRef
      );
      if (!itemSnapshot.exists || !['quarantined', 'restoring'].includes(itemSnapshot.data().status)) {
        throw new HttpsError('not-found', 'This item is not available to restore.');
      }
      const item = itemSnapshot.data();
      if (!item.expiresAt || item.expiresAt.toMillis() <= firestore.Timestamp.now().toMillis()) {
        throw new HttpsError('failed-precondition', 'The 365-day retention period has ended; this item is scheduled for permanent deletion.');
      }
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      const projection = projectionSnapshot.exists ? projectionSnapshot.data() : null;
      if (!profile || !canReview(role, profile, projection,
          { visibility: item.visibility }, item.visibility === 'community')) {
        throw new HttpsError('permission-denied', 'Your role cannot restore this item for the member’s current sharing settings.');
      }
      if (item.status === 'quarantined') {
        transaction.update(itemRef, { status: 'restoring', updatedAt: timestamp() });
        audit(transaction, 'gallery.restore_started', uid, targetUid, { itemId: id });
      }
      return item;
    });

    const sourceFile = bucket.file(state.path);
    const archiveFile = bucket.file(state.quarantinePath);
    try {
      const [sourceExists] = await sourceFile.exists();
      const [archiveExists] = await archiveFile.exists();
      if (archiveExists) await copyWithoutDownloadToken(archiveFile, sourceFile);
      else if (!sourceExists) throw new Error('Neither the original nor the quarantine copy exists.');
      else await sourceFile.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
      await archiveFile.delete({ ignoreNotFound: true });
    } catch (error) {
      console.error('Gallery restore did not complete:', error.code || error.message, state.path);
      throw new HttpsError('unavailable', 'Restore did not finish. The item remains gated; retry the action or contact the site owner.');
    }

    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(itemRef);
      if (!current.exists || current.data().status !== 'restoring') {
        throw new HttpsError('failed-precondition', 'The restore state changed before it could be completed.');
      }
      const active = await transaction.get(parentRef.collection('items').where('status', 'in', ACTIVE_STATES));
      const remaining = active.docs.filter((doc) => doc.id !== id).length;
      transaction.delete(itemRef);
      if (remaining === 0) transaction.delete(parentRef);
      else transaction.set(parentRef, { activeCount: remaining, updatedAt: timestamp() }, { merge: true });
      audit(transaction, 'gallery.restored', actor, targetUid, { itemId: id });
    });
    return { restored: true };
  }

  async function expireOne(snapshot, now) {
    const item = snapshot.data();
    if (!['quarantining', 'quarantined', 'restoring', 'expiring'].includes(item.status) ||
        !item.expiresAt || item.expiresAt.toMillis() > now.toMillis()) return false;
    const targetUid = item.ownerUid;
    const parsed = parseGalleryPath(targetUid, item.path);
    if (!parsed || typeof item.quarantinePath !== 'string' ||
        !item.quarantinePath.startsWith('moderationQuarantine/' + targetUid + '/')) {
      throw new Error('Quarantine record has an invalid owner or storage path.');
    }

    const claimId = randomUUID();
    const claimed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(snapshot.ref);
      if (!current.exists || !['quarantining', 'quarantined', 'restoring', 'expiring'].includes(current.data().status) ||
          !current.data().expiresAt || current.data().expiresAt.toMillis() > now.toMillis()) return false;
      const currentData = current.data();
      const lockAt = currentData.status === 'expiring' ? currentData.expiryClaimedAt : currentData.updatedAt;
      if (lockAt && typeof lockAt.toMillis === 'function' && lockAt.toMillis() > now.toMillis() - 15 * 60 * 1000) return false;
      transaction.update(snapshot.ref, {
        status: 'expiring', expiryClaimId: claimId, expiryClaimedAt: now, updatedAt: timestamp()
      });
      return true;
    });
    if (!claimed) return false;

    await bucket.file(item.path).delete({ ignoreNotFound: true });
    await bucket.file(item.quarantinePath).delete({ ignoreNotFound: true });

    const profileRef = db.collection('users').doc(targetUid);
    const projectionRef = db.collection('communityProfiles').doc(targetUid);
    const parentRef = parentRefFor(targetUid);
    let stillHasPost = false;
    const prepared = await db.runTransaction(async (transaction) => {
      const [current, parent, profileSnapshot, projectionSnapshot] = await transaction.getAll(
        snapshot.ref, parentRef, profileRef, projectionRef
      );
      if (!current.exists || current.data().status !== 'expiring' || current.data().expiryClaimId !== claimId ||
          !current.data().expiresAt || current.data().expiresAt.toMillis() > now.toMillis()) return false;
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      const remaining = profile && Array.isArray(profile.interestMedia)
        ? profile.interestMedia.filter((entry) => entry && entry.path !== item.path)
        : [];
      stillHasPost = remaining.some((entry) => postId(entry, entry.path) === item.postId);
      if (profileSnapshot.exists) {
        transaction.update(profileRef, { interestMedia: remaining, updatedAt: timestamp() });
      }
      if (projectionSnapshot.exists) {
        const projection = projectionSnapshot.data();
        const sharedItems = Array.isArray(projection.interestMedia)
          ? projection.interestMedia.filter((entry) => entry && entry.path !== item.path)
          : [];
        const sharedPostIds = Object.assign({}, projection.sharedPostIds || {});
        if (!stillHasPost) delete sharedPostIds[item.postId];
        transaction.update(projectionRef, { interestMedia: sharedItems, sharedPostIds, updatedAt: timestamp() });
      }
      if (!parent.exists) transaction.set(parentRef, { activeCount: 1, updatedAt: timestamp() });
      return true;
    });
    if (!prepared) return false;
    if (!stillHasPost) {
      if (typeof db.recursiveDelete !== 'function') throw new Error('Firestore recursiveDelete is unavailable.');
      await db.recursiveDelete(db.collection('galleryEngagement').doc(targetUid).collection('posts').doc(item.postId));
    }

    return db.runTransaction(async (transaction) => {
      const current = await transaction.get(snapshot.ref);
      if (!current.exists || current.data().status !== 'expiring' || current.data().expiryClaimId !== claimId ||
          !current.data().expiresAt || current.data().expiresAt.toMillis() > now.toMillis()) return false;
      const active = await transaction.get(parentRef.collection('items').where('status', 'in', ACTIVE_STATES));
      const otherActive = active.docs.filter((doc) => doc.id !== snapshot.id);
      transaction.delete(snapshot.ref);
      if (otherActive.length === 0) transaction.delete(parentRef);
      else transaction.set(parentRef, { activeCount: otherActive.length, updatedAt: timestamp() }, { merge: true });
      audit(transaction, 'gallery.quarantine_expired', 'retention-scheduler', targetUid, { itemId: snapshot.id });
      return true;
    });
  }

  function parentRefFor(uid) {
    return db.collection('galleryModeration').doc(uid);
  }

  const expireQuarantinedGalleryItems = onSchedule({
    schedule: 'every 24 hours',
    timeZone: 'UTC',
    region: 'europe-west2',
    maxInstances: 1
  }, async () => {
    const now = firestore.Timestamp.now();
    const snapshot = await db.collectionGroup('items').where('expiresAt', '<=', now).limit(100).get();
    let removed = 0;
    for (const item of snapshot.docs) {
      try {
        if (await expireOne(item, now)) removed++;
      } catch (error) {
        console.error('Expired quarantine cleanup failed:', item.ref.path, error.code || error.message);
      }
    }
    return { removed, scanned: snapshot.size };
  });

  return {
    quarantineGalleryItem: onCall(options, quarantine),
    listGalleryQuarantine: onCall(options, listQuarantine),
    restoreGalleryItem: onCall(options, restore),
    expireQuarantinedGalleryItems
  };
};
