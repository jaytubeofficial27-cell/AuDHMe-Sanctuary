# AuDHMe backend setup

> **Preview safety:** The commands below target the Firebase project ID embedded in this draft. They change that project's hosted backend. Do not run them for a preview until you have confirmed that the selected Firebase project is a dedicated preview project and updated the project ID, bucket, OAuth settings, and `SITE_URL` accordingly. The HTML itself can be reviewed without deploying these backend changes.

The page uses Firebase Authentication and private Firestore profile documents. Stripe Checkout is created by a Firebase callable function; prices, first-order discount eligibility, and payment confirmation are handled server-side. The three hoodie styles are £39.99 each, with £6.50 UK shipping per order. Sizes are S, M, and L.

## Before deploying

1. Use a Firebase project on the Blaze plan with Cloud Firestore enabled. This project ID is already used by the page: `audhme-sanctuary-b73dd`.
2. Install Node.js 22, Firebase CLI, then run `npm install` from `functions/`.
3. Store the Stripe secret key in Firebase Secret Manager. Never put it in the HTML or a checked-in `.env` file:

   ```powershell
   firebase functions:secrets:set STRIPE_SECRET_KEY --project audhme-sanctuary-b73dd
   ```

4. Deploy Firestore and Storage rules and the callable functions:

   ```powershell
   firebase deploy --only firestore:rules,storage --project audhme-sanctuary-b73dd
   firebase deploy --only functions:createCheckoutSession,functions:verifyCheckoutSession,functions:listCommunityProfiles,functions:recordGalleryView,functions:getGalleryViewCounts,functions:deleteGalleryViews --project audhme-sanctuary-b73dd
   ```

   The project-specific functions environment file sets `SITE_URL` to `https://audhme.org`. For another project or hosting address, configure `SITE_URL` to the canonical HTTPS URL serving that project's HTML file; include the path if it is served at a named path.

   The staff and moderation features are deployed separately after their integration tests pass. Do not deploy them to production as part of preview setup.

### Local rules tests

The integration suite uses a demo project and the Auth, Firestore and Storage emulators; it does not connect to production. Install Java 11 or newer, then from `functions/` run:

```powershell
npm ci
npm test
npm run test:rules
```

The emulator tests exercise private profiles and media, public read-only atmosphere settings, notification isolation, denial of direct staff-role, audit and moderation writes, matching role records and refreshed Auth claims, and staff-driven quarantine, restore and retention cleanup against the Firestore and Storage emulators. Staff callables are invoked directly; the Cloud Functions transport itself is not emulated. Unit tests cover the 365-day expiry calculation, role limits and download-token removal.

Quarantining first creates a server-only access gate, copies the media with its Firebase download token stripped into the rules-denied `moderationQuarantine/` prefix, then revokes the source token and removes the original object. Restore copies the private object back without its old bearer token and removes the gate only after the copy succeeds. A profile remains hidden from the community while any item is quarantined; members and moderators can only act on currently shared items, while admins and the owner may review private items. Already downloaded or cached copies cannot be recalled.

Unrestored items are permanently deleted 365 days after quarantine. The scheduled function runs daily, removes the private and any original object, removes profile/projection references and post engagement, then removes the access gate. A failed cleanup remains gated and is retried by a later run. A restore attempted after the expiry time is rejected. Deploy Storage rules and the moderation functions together.

Site atmosphere policy is publicly readable and writable only through a verified owner/admin callable. It controls whether automatic time-of-day, calendar-season, calendar-holiday and live-weather adaptation is allowed. Time and calendar signals are resolved in each visitor's browser; visitor settings and sensory preferences remain in effect. Live weather remains opt-in per visitor, uses that browser's location permission, and is not requested when disabled site-wide.

The fixed owner account initializes its server-managed owner role and claim when signing in. Other staff claims are derived from the server-managed role record and refreshed when that record changes. Privileged callables require the current record and token claim to agree, so a stale elevated claim is rejected after demotion or revocation; the account must synchronize and refresh its token to obtain a new role. A failed synchronization leaves staff access unavailable and is reported to the member. Changes to Firebase custom claims are separate from Firestore transactions, so verify role-change recovery with dedicated non-production accounts before deployment.

Before deploying, also verify the full invitation/role-revocation flow, confirm privacy notices describe actual access and 365-day deletion, review the functions and rules together, and test with dedicated non-production accounts. Obtain approval before deploying to the live project.

To deploy the admin and moderation features after testing against an isolated project, deploy the updated rules and these functions together:

```powershell
firebase deploy --only firestore:rules,storage,functions:getStaffRole,functions:syncMyStaffClaim,functions:inviteStaff,functions:respondStaffInvitation,functions:revokeStaff,functions:changeStaffRole,functions:markStaffNotificationRead,functions:listStaff,functions:listModerationProfiles,functions:listAdminAudit,functions:updateSiteAtmospherePolicy,functions:staffDiagnostics,functions:quarantineGalleryItem,functions:listGalleryQuarantine,functions:restoreGalleryItem,functions:expireQuarantinedGalleryItems --project YOUR_CONFIRMED_PROJECT_ID
```

The scheduled retention function requires Cloud Scheduler support in the project. Its first deployment creates a daily scheduled job; confirm the target project and retention notice before enabling it.

5. In Stripe Workbench, add a webhook endpoint at:

   `https://europe-west2-audhme-sanctuary-b73dd.cloudfunctions.net/stripeWebhook`

   Subscribe to `checkout.session.completed`, `checkout.session.expired`, and `checkout.session.async_payment_succeeded`. Store the endpoint's signing secret in Firebase Secret Manager, then deploy the webhook:

   ```powershell
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project audhme-sanctuary-b73dd
   firebase deploy --only functions:stripeWebhook --project audhme-sanctuary-b73dd
   ```

6. Deploy the updated HTML to the same origin configured as `SITE_URL`.

The Stripe webhook records paid orders and consumes the 15% first-order perk only after payment succeeds. Expired checkout sessions release an unused perk reservation. Order fulfillment and shipping notices remain a manual business process; the payment backend does not connect to a courier or inventory system.

If checkout or the directory is unavailable, inspect the callable function logs in the Firebase console for the configured project and `europe-west2` region. Confirm that the functions were deployed, that the project has billing enabled, and that `STRIPE_SECRET_KEY` and `SITE_URL` are configured for checkout. A local preview cannot verify production Stripe configuration.

## Privacy rules

`firestore.rules` keeps each `users/{uid}` account profile readable only by its signed-in owner. Opted-in fields are copied into a separate `communityProfiles/{uid}` projection that other signed-in Sanctuary members can read; no profile or media is visible to signed-out visitors. `orders/{sessionId}` (including delivery details needed to fulfil the hoodie order) is readable by the owning account and writable only by the Admin SDK webhook.

The staff directory-audit and moderation callables use the Admin SDK and check that the caller's current staff role record matches the token claim on each request. The owner and admins can review private profile details and moderate their gallery; moderators can review and moderate currently shared items only. Directory review, staff changes, moderation and atmosphere-policy changes are logged to a server-written audit collection. Profile owners can read their own inbox and staff role, but cannot write either directly. The new staff/moderation functions and rules must be deployed together and communicated to members before use.

## Google sign-in

The page uses Google Identity Services to obtain a credential and Firebase Authentication to sign the user in. In Firebase Console → Authentication → Settings → Authorized domains, add the exact hosting domain used by the page (for example, the Firebase Hosting domain and any custom domain). In Google Cloud Console, check that the OAuth client ID in the HTML is a Web application client and that its authorized JavaScript origins include the page's HTTPS origin and any local development origin you use. Also check that Google is enabled under Firebase Authentication → Sign-in method. The browser message “authorization blocked” usually indicates that the active origin/client or OAuth consent configuration does not permit the request; the exact blocked page or console error identifies which setting is missing.


## Special-interest gallery and sharing

The redesign stores new profile gallery files in Firebase Storage at `users/{uid}/gallery/{file}`. Existing items at `users/{uid}/interests/{file}` remain readable, shareable, and removable. Owners can read, upload, update sharing metadata, or delete only files under their own UID. Other signed-in members can read an item only while the profile is shared and the item is not private. Storage rules accept JPEG, PNG, WebP, GIF, MP4, WebM, or QuickTime video, up to 30 MB; the page applies the narrower 12 MB photo and 30 MB video limits and caps each gallery at 12 items. The Firestore profile document stores only file paths and basic file labels, never public download URLs.

New profiles are visible to signed-in members by default, including their username, profile picture, bio, neurotypes and links. Existing profile privacy choices are preserved. Making a profile private hides the profile and all its gallery items from other members, regardless of each item's setting; sharing it again makes items marked for sharing visible again, while individually private items stay private. Each upload offers these item-level choices and defaults to private when the profile is private. Each item's menu also allows archiving or deletion. Archived items are private, count towards the 12-item limit, and can be restored as private from the owner-only archive. Previously shared content may have been saved by viewers. Before deploying, enable Firebase Storage for the project and deploy the included `storage.rules` alongside the Firestore rules. The page uses modular `uploadBytes` and authenticated `getBlob` reads (not shareable download-token URLs), reusing the signed-in compat Storage reference; configure bucket CORS before expecting browser previews to load or upload gallery media. The included `storage-cors.json` allows the `audhme.org` origins plus local preview origins on port 4173 and permits the upload methods used by Firebase Storage. Confirm the bucket name in Firebase Console matches `storageBucket` in `js/app.js`. With Google Cloud SDK installed, apply CORS to that exact bucket, for example `gsutil cors set storage-cors.json gs://audhme-sanctuary-b73dd.firebasestorage.app` from this folder if the console confirms that name. Do not enable broad public read access.

Files selected in a single upload are grouped into a carousel; each file still counts towards the 12-item limit and retains its own sharing, archive and delete controls through the carousel's Edit menu. Existing ungrouped items remain individual tiles. The community projection includes the group identifier only for shared items, so a member sees only the items they can access.

The expanded viewer reuses the authenticated blob already loaded or loading for the first thumbnail, avoiding a second download. Other carousel items load on demand; object URLs are released when the viewer closes or the gallery is refreshed. No public download URLs or persistent media cache are used.

Likes and comments belong to a whole post, including a carousel, and are readable by signed-in members only while the profile is shared and at least one of its items is shared. Each member can like once; comment authors and post owners can delete comments. The owner's `communityProfiles` projection contains shared post IDs for rules to check; existing projections acquire them when the owner next signs in or saves a profile change. When a profile or post becomes private its engagement remains stored for a future reshare and can only be read by its owner; members can still delete their own likes or comments. Deleting the final item of a post removes its likes and comments before deleting the file; deletion errors are reported. Deploy both updated Storage and Firestore rules before the updated page.

Opening a shared post records one view per signed-in member, excluding the owner; carousel slides and repeat opens do not add more views. Counts start when this feature is deployed and are shown only to the owner, including after a post becomes private or archived. The callable functions keep viewer records inaccessible to clients and return counts only, not viewer identities. Deleting the final item removes the post's view records. In the expanded viewer, the owner's three-dot menu offers editing, archiving and deletion (or restoration for archived items). Sharing controls are in Edit; title and description changes apply to the whole carousel, while sharing, archiving and deletion apply to the selected item. Deploy the three gallery view functions and Firestore rules before publishing the updated page.

Members can reply to comments, copy their text, and edit their own comments. Replies are shown in the same newest-first, paginated feed with the original author's name; selecting it goes to the original if it is loaded. Replies remain if the original is deleted. Comment authors and post owners can delete comments, but only authors can edit them, and only while the post is shared. Reply creation verifies that the referenced comment exists on the same post. Deploy the updated Firestore rules before the page for replies and edits to work.

The Storage Rules also check the private Firestore profile before each new upload and reject uploads once 12 items are registered. Since the page uploads sequentially and saves each file path before starting the next upload, that limit is checked server-side. Storage Rules will ask Firebase to connect to Cloud Firestore on first deployment; approve that connection for the project.

The directory uses the authenticated `listCommunityProfiles` callable in `europe-west2` to check the private profile setting before returning directory details. This also filters older stale public projections belonging to private profiles. The directory checks at most 50 shared-profile projections; pagination is not implemented yet, so stale projections may reduce the number shown until their owners sign in. Deploy this function and both updated rules files before the page; older page versions that query the directory directly will no longer work with the tightened Firestore rules.

Members may choose multiple live Neuro-Code statuses on their profile using the searchable, grouped status editor. The profile initially shows three codes with an expandable list for the rest; no selections are removed by this display limit. These persist until changed or cleared and are included in the community projection only while the profile is shared. Deploy the updated Firestore rules before publishing this frontend; older rules reject the new field.

The site source is split into `index.html`, `css/site.css`, `css/redesign.css`, and `js/app.js`. Keep `js/app.js` as a classic script while the HTML uses inline handlers. The shop has its own `#store` route and navigation entry.
