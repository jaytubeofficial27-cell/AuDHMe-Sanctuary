'use strict';

const admin = require('firebase-admin');
const { randomUUID } = require('node:crypto');
const { defineSecret, defineString } = require('firebase-functions/params');
const { HttpsError, onCall, onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');

admin.initializeApp();
const db = admin.firestore();
Object.assign(exports, require('./staff')(admin, db, HttpsError, onCall));
Object.assign(exports, require('./moderation')(
  admin, db, admin.storage().bucket(), HttpsError, onCall, onSchedule
));
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const SITE_URL = defineString('SITE_URL', {
  default: 'https://audhme.org',
  description: 'Canonical HTTPS URL of the hosted AuDHMe HTML page, without query or fragment'
});

const PRODUCTS = Object.freeze({
  'core-hoodie': Object.freeze({
    name: 'The AuDHMe Core Hoodie', currency: 'gbp', unitAmount: 3999,
    sizes: Object.freeze(['S', 'M', 'L']),
    colors: Object.freeze(['Black', 'Navy Blazer', 'Charcoal Heather', 'Vintage Black', 'Forest Green', 'White'])
  }),
  'spectrum-hoodie': Object.freeze({
    name: 'The Spectrum Hoodie', currency: 'gbp', unitAmount: 3999,
    sizes: Object.freeze(['S', 'M', 'L']),
    colors: Object.freeze(['Black', 'White'])
  }),
  'spectrum-hoodie-black': Object.freeze({
    name: 'The Spectrum Hoodie', currency: 'gbp', unitAmount: 3999,
    sizes: Object.freeze(['S', 'M', 'L']), colors: Object.freeze(['Black', 'White']),
    canonicalSku: 'spectrum-hoodie', defaultColor: 'Black'
  }),
  'spectrum-hoodie-white': Object.freeze({
    name: 'The Spectrum Hoodie', currency: 'gbp', unitAmount: 3999,
    sizes: Object.freeze(['S', 'M', 'L']), colors: Object.freeze(['Black', 'White']),
    canonicalSku: 'spectrum-hoodie', defaultColor: 'White'
  })
});
const UK_SHIPPING_AMOUNT = 650;

function getStripe() {
  return require('stripe')(STRIPE_SECRET_KEY.value());
}

exports.listCommunityProfiles = onCall({
  region: 'europe-west2',
  maxInstances: 5
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to explore the community.');
  return db.runTransaction(async (transaction) => {
    const projections = await transaction.get(db.collection('communityProfiles').where('profileVisible', '==', true).limit(50));
    if (projections.empty) return [];
    const profiles = await transaction.getAll(...projections.docs.map((snapshot) => db.collection('users').doc(snapshot.id)));
    const moderation = await transaction.getAll(...projections.docs.map((snapshot) => db.collection('galleryModeration').doc(snapshot.id)));
    return projections.docs.flatMap((snapshot, index) => {
      if (moderation[index].exists || !profiles[index].exists || profiles[index].data().communityVisible !== true) return [];
      const data = snapshot.data();
      return [{ uid: snapshot.id, username: data.username, avatar: data.avatar || null, bio: data.bio || '', neurotypes: Array.isArray(data.neurotypes) ? data.neurotypes : [], profileVisible: true }];
    });
  }, { readOnly: true });
});

function validGalleryPostId(postId) {
  return typeof postId === 'string' && postId.length <= 250 && /^(g_[a-zA-Z0-9_-]{1,120}|s_[^/]+)$/.test(postId);
}

function galleryViews(ownerId, postId) {
  return db.collection('galleryEngagement').doc(ownerId).collection('posts').doc(postId).collection('views');
}

exports.recordGalleryView = onCall({ region: 'europe-west2', maxInstances: 5 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to view this post.');
  const { ownerId, postId } = request.data || {};
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 128 || ownerId.includes('/') || ownerId === '.' || ownerId === '..' || !validGalleryPostId(postId)) {
    throw new HttpsError('invalid-argument', 'Invalid post.');
  }
  if (ownerId === request.auth.uid) return { recorded: false };
  const owner = db.collection('users').doc(ownerId);
  const projection = db.collection('communityProfiles').doc(ownerId);
  const view = galleryViews(ownerId, postId).doc(request.auth.uid);
  await db.runTransaction(async (transaction) => {
    const [profile, shared, existing, moderated] = await transaction.getAll(owner, projection, view, db.collection('galleryModeration').doc(ownerId));
    if (moderated.exists || !profile.exists || profile.data().communityVisible !== true || !shared.exists ||
        shared.data().profileVisible !== true || !shared.data().sharedPostIds ||
        shared.data().sharedPostIds[postId] !== true) {
      throw new HttpsError('permission-denied', 'This post is no longer shared.');
    }
    if (!existing.exists) transaction.create(view, { recordedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { recorded: true };
});

exports.getGalleryViewCounts = onCall({ region: 'europe-west2', maxInstances: 5 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to see post views.');
  const postIds = request.data && request.data.postIds;
  if (!Array.isArray(postIds) || postIds.length > 12 || !postIds.every(validGalleryPostId)) {
    throw new HttpsError('invalid-argument', 'Invalid posts.');
  }
  const ids = [...new Set(postIds)];
  const results = await Promise.all(ids.map((postId) => galleryViews(request.auth.uid, postId).count().get()));
  return Object.fromEntries(ids.map((postId, index) => [postId, results[index].data().count]));
});

exports.deleteGalleryViews = onCall({ region: 'europe-west2', maxInstances: 5 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to manage posts.');
  const postId = request.data && request.data.postId;
  if (!validGalleryPostId(postId)) throw new HttpsError('invalid-argument', 'Invalid post.');
  const views = galleryViews(request.auth.uid, postId);
  let snapshot;
  do {
    snapshot = await views.limit(400).get();
    if (!snapshot.empty) {
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  } while (!snapshot.empty);
  return { deleted: true };
});

function getSiteUrl() {
  let parsed;
  try {
    parsed = new URL(SITE_URL.value());
  } catch (_) {
    throw new HttpsError('failed-precondition', 'SITE_URL must be a valid HTTPS origin.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new HttpsError('failed-precondition', 'SITE_URL must be an HTTPS URL without credentials, query, or fragment.');
  }
  return parsed.origin + parsed.pathname;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 10) {
    throw new HttpsError('invalid-argument', 'Choose between 1 and 10 basket items.');
  }
  return items.map((item) => {
    if (!item || typeof item !== 'object') throw new HttpsError('invalid-argument', 'Basket item is invalid.');
    const product = Object.prototype.hasOwnProperty.call(PRODUCTS, item.sku) ? PRODUCTS[item.sku] : null;
    const size = String(item.size || '').toUpperCase();
    const sku = product && (product.canonicalSku || item.sku);
    const canonicalProduct = sku && PRODUCTS[sku];
    const color = String(item.color || product && product.defaultColor || canonicalProduct && canonicalProduct.colors[0] || '').trim();
    if (!product || !canonicalProduct || !canonicalProduct.sizes.includes(size) || !canonicalProduct.colors.includes(color)) {
      throw new HttpsError('invalid-argument', 'A basket item, size, or colour is not available.');
    }
    return { sku, size, color, product: canonicalProduct };
  });
}

async function reserveFirstOrderPerk(userId) {
  const userRef = db.collection('users').doc(userId);
  const reservationId = randomUUID();
  const now = admin.firestore.Timestamp.now();
  const staleBefore = now.toMillis() - 24 * 60 * 60 * 1000;

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) throw new HttpsError('failed-precondition', 'Complete your account profile before checkout.');
    const profile = snapshot.data();
    if (profile.perkRedeemedAt) return null;
    if (profile.perkReservationId && profile.perkReservationCreatedAt && profile.perkReservationCreatedAt.toMillis() > staleBefore) return null;
    transaction.update(userRef, {
      perkReservationId: reservationId,
      perkReservationCreatedAt: now,
      perkReservationSessionId: admin.firestore.FieldValue.delete()
    });
    return reservationId;
  });
}

async function releaseReservation(userId, reservationId) {
  if (!reservationId) return;
  const userRef = db.collection('users').doc(userId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (snapshot.exists && snapshot.data().perkReservationId === reservationId) {
      transaction.update(userRef, {
        perkReservationId: admin.firestore.FieldValue.delete(),
        perkReservationCreatedAt: admin.firestore.FieldValue.delete(),
        perkReservationSessionId: admin.firestore.FieldValue.delete()
      });
    }
  });
}

async function markPaidOrder(session) {
  const userId = session.metadata && session.metadata.firebaseUid;
  if (!userId || session.payment_status !== 'paid') return;

  let items = [];
  try {
    const metadataItems = JSON.parse(session.metadata.cartItems || '[]');
    items = Array.isArray(metadataItems) ? metadataItems.map((item) => (
      Array.isArray(item) ? { sku: item[0], size: item[1], color: item[2] } : item
    )) : [];
  } catch (_) { /* keep the order record even if metadata is malformed */ }
  await db.collection('orders').doc(session.id).set({
    uid: userId,
    status: 'paid',
    currency: session.currency || 'gbp',
    amountTotal: Number(session.amount_total) || 0,
    customerEmail: session.customer_details && session.customer_details.email || null,
    shippingDetails: session.shipping_details || null,
    items,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  const reservationId = session.metadata.perkReservationId;
  if (!reservationId) return;
  const userRef = db.collection('users').doc(userId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists || snapshot.data().perkReservationId !== reservationId) return;
    transaction.update(userRef, {
      perkRedeemedAt: admin.firestore.FieldValue.serverTimestamp(),
      perkReservationId: admin.firestore.FieldValue.delete(),
      perkReservationCreatedAt: admin.firestore.FieldValue.delete(),
      perkReservationSessionId: admin.firestore.FieldValue.delete()
    });
  });
}

exports.createCheckoutSession = onCall({
  region: 'europe-west2',
  secrets: [STRIPE_SECRET_KEY],
  maxInstances: 5
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before checkout.');
  const items = normalizeItems(request.data && request.data.items);
  const userId = request.auth.uid;
  const stripe = getStripe();
  const origin = getSiteUrl();
  let reservationId = null;

  try {
    reservationId = await reserveFirstOrderPerk(userId);
    const discounts = [];
    if (reservationId) {
      const coupon = await stripe.coupons.create({
        percent_off: 15,
        duration: 'once',
        max_redemptions: 1,
        name: 'AuDHMe first order'
      }, { idempotencyKey: 'audhme-first-order-' + reservationId });
      discounts.push({ coupon: coupon.id });
    }

    const metadataItems = items.map(({ sku, size, color }) => [sku, size, color]);
    const sessionOptions = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: items.map(({ size, color, product }) => ({
        quantity: 1,
        price_data: {
          currency: product.currency,
          unit_amount: product.unitAmount,
          product_data: { name: product.name + ' (' + color + ', Size ' + size + ')' }
        }
      })),
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: UK_SHIPPING_AMOUNT, currency: 'gbp' },
          display_name: 'UK shipping'
        }
      }],
      customer_email: request.auth.token.email || undefined,
      client_reference_id: userId,
      metadata: {
        firebaseUid: userId,
        perkReservationId: reservationId || '',
        cartItems: JSON.stringify(metadataItems)
      },
      shipping_address_collection: { allowed_countries: ['GB'] },
      success_url: origin + '?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '?checkout=cancelled'
    };
    if (discounts.length) sessionOptions.discounts = discounts;
    const session = await stripe.checkout.sessions.create(sessionOptions);

    if (reservationId) {
      await db.collection('users').doc(userId).update({ perkReservationSessionId: session.id });
    }
    return { url: session.url };
  } catch (error) {
    if (reservationId) await releaseReservation(userId, reservationId).catch(() => {});
    if (error instanceof HttpsError) throw error;
    console.error('Stripe Checkout session creation failed:', error.message);
    throw new HttpsError('internal', 'Checkout could not be created.');
  }
});

exports.verifyCheckoutSession = onCall({
  region: 'europe-west2',
  secrets: [STRIPE_SECRET_KEY],
  maxInstances: 5
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to verify this order.');
  const sessionId = request.data && request.data.sessionId;
  if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_') || sessionId.length > 200) {
    throw new HttpsError('invalid-argument', 'Checkout session ID is invalid.');
  }
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  const isPaid = session.metadata && session.metadata.firebaseUid === request.auth.uid && session.payment_status === 'paid';
  if (isPaid) await markPaidOrder(session);
  return { paid: Boolean(isPaid) };
});

exports.stripeWebhook = onRequest({
  region: 'europe-west2',
  secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
  maxInstances: 5
}, async (request, response) => {
  if (request.method !== 'POST') return response.status(405).send('Method not allowed');
  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      request.rawBody,
      request.headers['stripe-signature'],
      STRIPE_WEBHOOK_SECRET.value()
    );
  } catch (error) {
    console.warn('Rejected Stripe webhook with invalid signature.');
    return response.status(400).send('Invalid signature');
  }

  const session = event.data && event.data.object;
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await markPaidOrder(session);
    } else if (event.type === 'checkout.session.expired' && session.metadata && session.metadata.firebaseUid) {
      await releaseReservation(session.metadata.firebaseUid, session.metadata.perkReservationId);
    }
    return response.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook processing failed:', error.message);
    return response.status(500).send('Webhook processing failed');
  }
});
