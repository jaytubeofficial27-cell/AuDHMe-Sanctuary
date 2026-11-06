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

4. Deploy Firestore rules and the two callable functions:

   ```powershell
   firebase deploy --only firestore:rules,storage --project audhme-sanctuary-b73dd
   firebase deploy --only functions:createCheckoutSession,functions:verifyCheckoutSession --project audhme-sanctuary-b73dd
   ```

   Set `SITE_URL` to the canonical HTTPS URL serving this HTML file when prompted. The default is the root of the Firebase Hosting origin. If the file is served at a named path, include that path.

5. In Stripe Workbench, add a webhook endpoint at:

   `https://europe-west2-audhme-sanctuary-b73dd.cloudfunctions.net/stripeWebhook`

   Subscribe to `checkout.session.completed`, `checkout.session.expired`, and `checkout.session.async_payment_succeeded`. Store the endpoint's signing secret in Firebase Secret Manager, then deploy the webhook:

   ```powershell
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project audhme-sanctuary-b73dd
   firebase deploy --only functions:stripeWebhook --project audhme-sanctuary-b73dd
   ```

6. Deploy the updated HTML to the same origin configured as `SITE_URL`.

The Stripe webhook records paid orders and consumes the 15% first-order perk only after payment succeeds. Expired checkout sessions release an unused perk reservation. Order fulfillment and shipping notices remain a manual business process; the payment backend does not connect to a courier or inventory system.

## Privacy rules

`firestore.rules` keeps each `users/{uid}` account profile readable only by its signed-in owner. Opted-in fields are copied into a separate `communityProfiles/{uid}` projection that other signed-in Sanctuary members can read; no profile or media is visible to signed-out visitors. `orders/{sessionId}` (including delivery details needed to fulfil the hoodie order) is readable by the owning account and writable only by the Admin SDK webhook.

## Google sign-in

The page uses Google Identity Services to obtain a credential and Firebase Authentication to sign the user in. In Firebase Console → Authentication → Settings → Authorized domains, add the exact hosting domain used by the page (for example, the Firebase Hosting domain and any custom domain). In Google Cloud Console, check that the OAuth client ID in the HTML is a Web application client and that its authorized JavaScript origins include the page's HTTPS origin and any local development origin you use. Also check that Google is enabled under Firebase Authentication → Sign-in method. The browser message “authorization blocked” usually indicates that the active origin/client or OAuth consent configuration does not permit the request; the exact blocked page or console error identifies which setting is missing.


## Special-interest gallery and sharing

The redesign stores profile gallery files in Firebase Storage at `users/{uid}/interests/{file}`. Owners can read, upload, update sharing metadata, or delete only files under their own UID. Other signed-in members can read an item only when it was explicitly shared or inherits the account-level share setting. Storage rules accept JPEG, PNG, WebP, GIF, MP4, WebM, or QuickTime video, up to 30 MB; the page applies the narrower 12 MB photo and 30 MB video limits and caps each gallery at 12 items. The Firestore profile document stores only file paths and basic file labels, never public download URLs.

Profiles and gallery items start private. In Account Settings, members can opt in to share their username, profile picture, bio, neurotypes and links with signed-in members; individual photos/videos can be shared or made private separately. A media-only share shows the member's username but keeps their bio, neurotypes, links and profile picture private. The community directory lists the signed-in opt-ins only. Before deploying, enable Firebase Storage for the project and deploy the included `storage.rules` alongside the Firestore rules. The page uses authenticated `getBlob()` reads (not shareable download-token URLs); configure bucket CORS before expecting browser previews to load. The included `storage-cors.json` allows only the `audhme.org` origins. With Google Cloud SDK installed, run `gsutil cors set storage-cors.json gs://audhme-sanctuary-b73dd.appspot.com` from this folder (adjust the bucket name if Firebase Console shows a different one). Do not enable broad public read access.

The Storage Rules also check the private Firestore profile before each new upload and reject uploads once 12 items are registered. Since the page uploads sequentially and saves each file path before starting the next upload, that limit is checked server-side. Storage Rules will ask Firebase to connect to Cloud Firestore on first deployment; approve that connection for the project.

The site source is split into `index.html`, `css/site.css`, `css/redesign.css`, and `js/app.js`. Keep `js/app.js` as a classic script while the HTML uses inline handlers. The shop has its own `#store` route and navigation entry. The directory is capped at the first 50 opted-in profiles; pagination is not implemented yet.
