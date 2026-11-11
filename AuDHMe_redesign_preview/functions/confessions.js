'use strict';

const OWNER_UID = '4grgpBnKA9ROGhxJ0MoPn3yP3MV2';
const MODERATION_ACTIONS = ['quarantine', 'restore', 'delete'];

module.exports = function createConfessionFunctions(db, firestore, HttpsError, onCall) {
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

  function audit(transaction, action, actor, target, details) {
    transaction.create(db.collection('adminAudit').doc(), {
      action, actor, target, details, createdAt: timestamp()
    });
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

  const createConfession = onCall(options, async (request) => {
    const uid = requireUser(request);
    const text = request.data && request.data.text;
    if (typeof text !== 'string' || text.length === 0 || text.length > 1000) {
      throw new HttpsError('invalid-argument', 'Confession text must be between 1 and 1000 characters.');
    }
    const confessionRef = db.collection('confessions').doc();
    const authorRef = db.collection('confessionAuthors').doc(confessionRef.id);
    await db.runTransaction(async (transaction) => {
      transaction.create(confessionRef, { text, createdAt: timestamp(), status: 'visible' });
      transaction.create(authorRef, { uid });
      audit(transaction, 'confession.created', uid, confessionRef.id, {});
    });
    return { id: confessionRef.id };
  });

  const deleteConfession = onCall(options, async (request) => {
    const uid = requireUser(request);
    const id = request.data && request.data.id;
    if (!validId(id)) throw new HttpsError('invalid-argument', 'Invalid confession.');
    const confessionRef = db.collection('confessions').doc(id);
    const authorRef = db.collection('confessionAuthors').doc(id);
    await db.runTransaction(async (transaction) => {
      const authorSnapshot = await transaction.get(authorRef);
      if (!authorSnapshot.exists || authorSnapshot.data().uid !== uid) {
        throw new HttpsError('permission-denied', 'Only the author can delete this confession.');
      }
      transaction.delete(confessionRef);
      transaction.delete(authorRef);
      audit(transaction, 'confession.deleted', uid, id, {});
    });
    // Best-effort: the confession document and its author linkage are removed.
    // supports/comments subcollections are orphaned and unreachable by clients
    // (rules deny reads once the parent is missing); a scheduled cleanup may remove them.
    return { deleted: true };
  });

  const moderateConfession = onCall(options, async (request) => {
    const id = request.data && request.data.id;
    const action = request.data && request.data.action;
    if (!validId(id) || !MODERATION_ACTIONS.includes(action)) {
      throw new HttpsError('invalid-argument', 'Choose a valid confession and moderation action.');
    }
    const confessionRef = db.collection('confessions').doc(id);
    const authorRef = db.collection('confessionAuthors').doc(id);
    await db.runTransaction(async (transaction) => {
      const { uid } = await requireStaff(transaction, request);
      const snapshot = await transaction.get(confessionRef);
      if (!snapshot.exists) throw new HttpsError('not-found', 'This confession no longer exists.');
      if (action === 'delete') {
        transaction.delete(confessionRef);
        transaction.delete(authorRef);
      } else {
        transaction.update(confessionRef, {
          status: action === 'quarantine' ? 'quarantined' : 'visible',
          updatedAt: timestamp()
        });
      }
      audit(transaction, 'confession.moderated', uid, id, { action });
    });
    return { moderated: true, action };
  });

  const listConfessionQueue = onCall(options, async (request) => {
    return db.runTransaction(async (transaction) => {
      const { uid } = await requireStaff(transaction, request);
      const snapshot = await transaction.get(
        db.collection('confessions').where('status', '==', 'quarantined').limit(100)
      );
      const items = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          text: data.text,
          createdAt: data.createdAt && typeof data.createdAt.toMillis === 'function'
            ? data.createdAt.toMillis() : null,
          status: data.status
        };
      });
      audit(transaction, 'confession.queue_viewed', uid, 'confessions', { count: items.length });
      return { items };
    });
  });

  return { createConfession, deleteConfession, moderateConfession, listConfessionQueue };
};
