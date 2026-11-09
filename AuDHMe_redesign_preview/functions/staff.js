'use strict';

const { randomUUID } = require('node:crypto');
const OWNER_UID = '4grgpBnKA9ROGhxJ0MoPn3yP3MV2';
const STAFF_ROLES = ['admin', 'moderator'];

module.exports = function createStaffFunctions(auth, db, firestore, HttpsError, onCall) {
  const options = { region: 'europe-west2', maxInstances: 5 };
  const timestamp = () => firestore.FieldValue.serverTimestamp();
  const atmosphereKeys = ['localTime', 'calendarSeason', 'calendarHoliday', 'liveWeather'];

  function requireUser(request) {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue.');
    return request.auth.uid;
  }
  async function requireOwner(request) {
    const uid = requireUser(request);
    if (uid !== OWNER_UID || !request.auth.token || request.auth.token.role !== 'owner') {
      throw new HttpsError('permission-denied', 'Only the owner can manage staff.');
    }
    const role = await db.collection('staffRoles').doc(uid).get();
    if (!role.exists || role.data().role !== 'owner') {
      throw new HttpsError('permission-denied', 'Owner role is not active.');
    }
  }
  function validId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 128 && !id.includes('/') && id !== '.' && id !== '..';
  }
  function audit(transaction, action, actor, target, details) {
    transaction.create(db.collection('adminAudit').doc(), {
      action, actor, target, details, createdAt: timestamp()
    });
  }

  const getStaffRole = onCall(options, async (request) => {
    const uid = requireUser(request);
    if (uid === OWNER_UID) return { role: 'owner' };
    const snapshot = await db.collection('staffRoles').doc(uid).get();
    return { role: snapshot.exists && STAFF_ROLES.includes(snapshot.data().role) ? snapshot.data().role : null };
  });

  const syncMyStaffClaim = onCall(options, async (request) => {
    const uid = requireUser(request);
    const roleRef = db.collection('staffRoles').doc(uid);
    if (uid === OWNER_UID) {
      await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(roleRef);
        if (!existing.exists) {
          transaction.create(roleRef, { role: 'owner', grantedAt: timestamp(), grantedBy: uid });
          audit(transaction, 'staff.owner_initialized', uid, uid, {});
        } else if (existing.data().role !== 'owner') {
          throw new HttpsError('failed-precondition', 'Owner role requires administrator repair.');
        }
      });
    }
    const snapshot = await roleRef.get();
    const role = snapshot.exists && (uid === OWNER_UID ? snapshot.data().role === 'owner' : STAFF_ROLES.includes(snapshot.data().role))
      ? snapshot.data().role : null;
    const user = await auth.getUser(uid);
    const claims = Object.assign({}, user.customClaims || {});
    if (role) claims.role = role;
    else delete claims.role;
    if ((user.customClaims && user.customClaims.role || null) !== role) {
      await auth.setCustomUserClaims(uid, claims);
    }
    return { role };
  });

  const inviteStaff = onCall(options, async (request) => {
    await requireOwner(request);
    const { email, role } = request.data || {};
    if (typeof email !== 'string' || email.length > 254 || !STAFF_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', 'Enter a registered email and a valid staff role.');
    }
    let user;
    try {
      user = await auth.getUserByEmail(email.trim());
    } catch (error) {
      if (error.code === 'auth/user-not-found') throw new HttpsError('not-found', 'No registered account uses that email.');
      throw error;
    }
    if (!user.emailVerified || user.disabled) throw new HttpsError('failed-precondition', 'The account must be enabled and have a verified email.');
    if (user.uid === OWNER_UID) throw new HttpsError('failed-precondition', 'The owner already has full access.');
    const invitation = db.collection('staffInvitations').doc(user.uid);
    const invitationId = randomUUID();
    const notification = db.collection('users').doc(user.uid).collection('notifications').doc(invitationId);
    const roleRef = db.collection('staffRoles').doc(user.uid);
    await db.runTransaction(async (transaction) => {
      const [currentRole, existingInvitation] = await transaction.getAll(roleRef, invitation);
      if (currentRole.exists) throw new HttpsError('failed-precondition', 'This account already has a staff role.');
      if (existingInvitation.exists && existingInvitation.data().status === 'pending') {
        throw new HttpsError('failed-precondition', 'This account already has a pending invitation.');
      }
      transaction.set(invitation, { uid: user.uid, invitationId, role, status: 'pending', createdBy: OWNER_UID, createdAt: timestamp() });
      transaction.set(notification, { type: 'staff-invitation', invitationId, role, read: false, createdAt: timestamp() });
      audit(transaction, 'staff.invited', OWNER_UID, user.uid, { role });
    });
    return { sent: true };
  });

  const respondStaffInvitation = onCall(options, async (request) => {
    const uid = requireUser(request);
    const { invitationId, accept } = request.data || {};
    if (!validId(invitationId) || typeof accept !== 'boolean') throw new HttpsError('invalid-argument', 'Invalid invitation response.');
    const invitation = db.collection('staffInvitations').doc(uid);
    const inbox = db.collection('users').doc(uid).collection('notifications').doc(invitationId);
    const roleRef = db.collection('staffRoles').doc(uid);
    await db.runTransaction(async (transaction) => {
      const [snapshot, currentRole] = await transaction.getAll(invitation, roleRef);
      if (!snapshot.exists || snapshot.data().uid !== uid || snapshot.data().invitationId !== invitationId || snapshot.data().status !== 'pending') {
        throw new HttpsError('failed-precondition', 'This invitation is no longer available.');
      }
      const role = snapshot.data().role;
      if (!STAFF_ROLES.includes(role)) throw new HttpsError('failed-precondition', 'The invitation is invalid.');
      if (accept && currentRole.exists) throw new HttpsError('failed-precondition', 'You already have a staff role.');
      transaction.update(invitation, { status: accept ? 'accepted' : 'declined', respondedAt: timestamp() });
      transaction.update(inbox, { read: true, status: accept ? 'accepted' : 'declined' });
      if (accept) transaction.create(roleRef, { role, grantedAt: timestamp(), grantedBy: OWNER_UID });
      audit(transaction, accept ? 'staff.accepted' : 'staff.declined', uid, uid, { role });
    });
    return { accepted: accept };
  });

  const revokeStaff = onCall(options, async (request) => {
    await requireOwner(request);
    const { uid } = request.data || {};
    if (!validId(uid) || uid === OWNER_UID) throw new HttpsError('invalid-argument', 'Invalid staff account.');
    const roleRef = db.collection('staffRoles').doc(uid);
    const invitation = db.collection('staffInvitations').doc(uid);
    await db.runTransaction(async (transaction) => {
      const [role, invite] = await transaction.getAll(roleRef, invitation);
      const pending = invite.exists && invite.data().status === 'pending';
      if (!role.exists && !pending) throw new HttpsError('not-found', 'No active role or pending invitations found.');
      if (role.exists) transaction.delete(roleRef);
      if (pending) {
        transaction.update(invite.ref, { status: 'revoked', revokedAt: timestamp() });
        transaction.update(db.collection('users').doc(uid).collection('notifications').doc(invite.data().invitationId), { status: 'revoked', read: true });
      }
      const notice = db.collection('users').doc(uid).collection('notifications').doc();
      transaction.create(notice, { type: 'staff-revoked', read: false, createdAt: timestamp() });
      audit(transaction, 'staff.revoked', OWNER_UID, uid, {});
    });
    return { revoked: true };
  });

  const changeStaffRole = onCall(options, async (request) => {
    await requireOwner(request);
    const { uid, role } = request.data || {};
    if (!validId(uid) || uid === OWNER_UID || !STAFF_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', 'Choose an existing staff account and a valid role.');
    }
    const roleRef = db.collection('staffRoles').doc(uid);
    const notice = db.collection('users').doc(uid).collection('notifications').doc();
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(roleRef);
      if (!current.exists || !STAFF_ROLES.includes(current.data().role)) {
        throw new HttpsError('not-found', 'This account does not have an active staff role.');
      }
      if (current.data().role === role) throw new HttpsError('failed-precondition', 'This member already has that role.');
      transaction.update(roleRef, { role, changedAt: timestamp(), changedBy: OWNER_UID });
      transaction.create(notice, { type: 'staff-role-changed', role, read: false, createdAt: timestamp() });
      audit(transaction, 'staff.role_changed', OWNER_UID, uid, { previousRole: current.data().role, role });
    });
    return { role };
  });

  const markStaffNotificationRead = onCall(options, async (request) => {
    const uid = requireUser(request);
    const notificationId = request.data && request.data.notificationId;
    if (!validId(notificationId)) throw new HttpsError('invalid-argument', 'Invalid notification.');
    const notification = db.collection('users').doc(uid).collection('notifications').doc(notificationId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(notification);
      if (!snapshot.exists) throw new HttpsError('not-found', 'Notification not found.');
      if (snapshot.data().type === 'staff-invitation' && !snapshot.data().status) {
        throw new HttpsError('failed-precondition', 'Respond to this invitation first.');
      }
      transaction.update(notification, { read: true });
    });
    return { read: true };
  });

  const listStaff = onCall(options, async (request) => {
    await requireOwner(request);
    const [roles, invites] = await Promise.all([
      db.collection('staffRoles').orderBy(firestore.FieldPath.documentId()).limit(100).get(),
      db.collection('staffInvitations').where('status', '==', 'pending').limit(100).get()
    ]);
    return {
      members: roles.docs.map((doc) => ({ uid: doc.id, role: doc.data().role })),
      invitations: invites.docs.map((doc) => ({ uid: doc.data().uid, role: doc.data().role }))
    };
  });

  const listModerationProfiles = onCall(options, async (request) => {
    const uid = requireUser(request);
    const cursor = request.data && request.data.cursor;
    if (cursor && !validId(cursor)) throw new HttpsError('invalid-argument', 'Invalid page cursor.');
    return db.runTransaction(async (transaction) => {
      const roleRef = db.collection('staffRoles').doc(uid);
      const roleSnapshot = await transaction.get(roleRef);
      const role = roleSnapshot.exists && roleSnapshot.data().role;
      if (!request.auth.token || request.auth.token.role !== role || (role === 'owner' && uid !== OWNER_UID)) {
        throw new HttpsError('permission-denied', 'Staff claim does not match the current role.');
      }
      if (!['owner', 'admin', 'moderator'].includes(role)) throw new HttpsError('permission-denied', 'Staff access is required.');
      const privateAccess = role !== 'moderator';
      let query = db.collection(privateAccess ? 'users' : 'communityProfiles')
        .orderBy(firestore.FieldPath.documentId()).limit(51);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await transaction.get(query);
      const page = snapshot.docs.slice(0, 50);
      const ownerSnapshots = !privateAccess && page.length
        ? await transaction.getAll(...page.map((doc) => db.collection('users').doc(doc.id)))
        : [];
      const results = page.flatMap((doc, index) => {
        const data = doc.data();
        if (!privateAccess && (data.visible !== true || data.profileVisible !== true ||
            !ownerSnapshots[index].exists || ownerSnapshots[index].data().communityVisible !== true)) return [];
        return [{
          uid: doc.id,
          username: typeof data.username === 'string' ? data.username : '',
          neurotypes: Array.isArray(data.neurotypes) ? data.neurotypes.filter((value) => typeof value === 'string').slice(0, 15) : [],
          communityVisible: privateAccess ? data.communityVisible === true : true,
          interestMedia: Array.isArray(data.interestMedia)
            ? data.interestMedia.filter((item) => item && typeof item.path === 'string' &&
              item.path.startsWith('users/' + doc.id + '/') && !item.path.slice(('users/' + doc.id + '/').length).includes('/'))
              .slice(0, 12).map((item) => ({
                path: item.path,
                name: typeof item.name === 'string' ? item.name.slice(0, 100) : '',
                type: typeof item.type === 'string' ? item.type.slice(0, 100) : '',
                visibility: item.visibility === 'private' ? 'private' : 'community',
                archived: item.archived === true
              }))
            : []
        }];
      });
      audit(transaction, 'profiles.reviewed', uid, privateAccess ? 'all' : 'shared', { cursor: cursor || '', count: results.length });
      return { profiles: results, nextCursor: snapshot.docs.length > 50 ? page[page.length - 1].id : null };
    });
  });

  const listAdminAudit = onCall(options, async (request) => {
    await requireOwner(request);
    const snapshot = await db.collection('adminAudit').orderBy('createdAt', 'desc').limit(50).get();
    return { entries: snapshot.docs.map((doc) => {
      const data = doc.data();
      return { action: data.action, actor: data.actor, target: data.target,
        createdAt: data.createdAt ? data.createdAt.toMillis() : null };
    }) };
  });

  const updateSiteAtmospherePolicy = onCall(options, async (request) => {
    const uid = requireUser(request);
    const policy = request.data && request.data.policy;
    if (!policy || typeof policy !== 'object' ||
        Object.keys(policy).length !== atmosphereKeys.length ||
        !atmosphereKeys.every((key) => typeof policy[key] === 'boolean')) {
      throw new HttpsError('invalid-argument', 'Choose a value for each atmosphere setting.');
    }
    await db.runTransaction(async (transaction) => {
      const [roleSnapshot, settingsSnapshot] = await transaction.getAll(
        db.collection('staffRoles').doc(uid),
        db.collection('siteSettings').doc('atmosphere')
      );
      const role = roleSnapshot.exists && roleSnapshot.data().role;
      if (!request.auth.token || request.auth.token.role !== role ||
          (role === 'owner' && uid !== OWNER_UID) || !['owner', 'admin'].includes(role)) {
        throw new HttpsError('permission-denied', 'Verified owner or admin access is required.');
      }
      const saved = Object.fromEntries(atmosphereKeys.map((key) => [key, policy[key]]));
      transaction.set(db.collection('siteSettings').doc('atmosphere'), {
        ...saved, updatedAt: timestamp()
      });
      audit(transaction, 'site.atmosphere_updated', uid, 'atmosphere', {
        previous: settingsSnapshot.exists
          ? Object.fromEntries(atmosphereKeys.map((key) => [key, settingsSnapshot.data()[key] === true]))
          : Object.fromEntries(atmosphereKeys.map((key) => [key, true])),
        policy: saved
      });
    });
    return { updated: true, policy: Object.fromEntries(atmosphereKeys.map((key) => [key, policy[key]])) };
  });

  const staffDiagnostics = onCall(options, async (request) => {
    const uid = requireUser(request);
    const started = Date.now();
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(db.collection('staffRoles').doc(uid));
      const role = snapshot.exists && snapshot.data().role;
      if (!request.auth.token || request.auth.token.role !== role || (role === 'owner' && uid !== OWNER_UID)) {
        throw new HttpsError('permission-denied', 'Staff claim does not match the current role.');
      }
      if (!['owner', 'admin', 'moderator'].includes(role)) throw new HttpsError('permission-denied', 'Staff access is required.');
      await transaction.get(db.collection('diagnosticState').doc('connectivity'));
      return {
        auth: 'Authenticated callable request verified',
        firestore: 'Server-side Firestore read succeeded',
        firestoreMilliseconds: Date.now() - started,
        storage: 'Quota usage is not available from this check. Upload rules currently limit each file to 30 MB and each gallery to 12 items.',
        securityRules: 'Not verified by this check. Use Firebase emulators and rule tests.'
      };
    });
  });

  return { getStaffRole, syncMyStaffClaim, inviteStaff, respondStaffInvitation, revokeStaff, changeStaffRole, markStaffNotificationRead, listStaff, listModerationProfiles, listAdminAudit, updateSiteAtmospherePolicy, staffDiagnostics };
};
