# AuDHMe Sanctuary — Update Changelog

Code-only update (no deployment, no live Firebase project touched). Vanilla JS / Firebase SPA, no build step added.

**Verification:** `node --check js/app.js` passes; `node --check functions/index.js functions/confessions.js functions/confessions.test.js` pass; `cd functions && npm test` → **27/27 pass** (23 existing + 4 new). firestore.rules braces balanced, rules_version '2' intact.

---

## 1. Mobile Nav Polish
- `js/app.js` — added `closeMobileNav()` helper; document-level tap-outside close + Escape-key close + focus return for the mobile menu and nav groups. Route-change / link-tap close (already present in `switchPage`/`switchView`) preserved. Buttons use `click` only (no touch+click double fire).
- `css/redesign.css` — `.audh-hamburger` and nav link touch targets now min 44×44px; added `audhNavSlideDown` open animation for mobile menu / group submenus; existing global `prefers-reduced-motion` rule zeroes animation/transition duration.

## 2. Community Directory & Profiles (speed + no preview wall)
- `js/app.js` (`renderCommunityDirectory`) — added pagination state (`directoryPage`, `DIRECTORY_PAGE_SIZE=24`, `directoryLastQuery`); search resets to page 1; renders `slice(0, page*24)` + "Load more members (N remaining)" button instead of everything at once. Verified directory cards render only avatar / name / bio / neurotypes / "Open profile" — no eager gallery previews. Full profile + gallery load only on open. Privacy filters (`communityVisible`/`profileVisible`, private gallery items) untouched.
- `css/redesign.css` — `.directory-load-more` styling.

## 3. Username vs. Profile Name (split fields)
- `index.html` — account settings form: new `edit-display-name` field (alongside username); onboarding form: new `onboard-display-name` field.
- `js/app.js` — `currentUser` load + onboarding fallback initializers read `displayName`; `openSettingsView` populates it; `handleProfileUpdate` / `handleOnboardingSubmit` / `persistUserProfile` save it to `users/{uid}`; `communityProfileProjection` includes `displayName` in the `communityProfiles/{uid}` projection. Every name render now uses `displayName || username` (back-compat fallback): profile header (`profile-display-username` + avatar initial), auth button label, directory card + search, `openCommunityProfile`, gallery comment `authorName`, admin member list. Username keeps the existing `lastUsernameChange` 30-day cooldown.
- `firestore.rules` (backend) — `validProfile()` gained optional `displayName` (string ≤40); `users` create `keys().hasOnly` + update `affectedKeys().hasOnly` and `communityProfiles` create keys all gained `'displayName'`. New helper `expectedAuthorName(uid)` returns `displayName` when present/non-empty else `username`; gallery-comment create rule now validates `authorName == expectedAuthorName(...)`.

## 4. Anonymous Confessions Page (NEW)
- `index.html` — new "Confessions" nav entry (Community dropdown); new `#confessions-view` with visible crisis/support banner (Samaritans 116 123 UK/Ireland, 988 US/Canada, text HOME to 741741, "you are not alone" language), signed-out prompt, composer textarea (max 1000 + counter), confession list + Load-more.
- `js/app.js` — wired `handleInitialRoute` / `showRouteLoading` / `switchView` (signed-out guard) / view-hide lists for the `confessions` route. New module: paginated list (`where status=='visible'`, newest first, limit 10); `submitConfession` via callable `createConfession` (europe-west2); own-confession ids tracked in `localStorage['audhme_my_confessions']` with Delete button (callable `deleteConfession`); support heart toggle via `confessions/{id}/supports/{uid}` doc `{uid}` + count; expandable anonymous comments (`confessions/{id}/comments`, `{text, createdAt}` only, labeled "Supporter", no name/uid collected). No real names collected.
- `functions/confessions.js` (NEW, backend) — factory wired in `functions/index.js`; callables (europe-west2): `createConfession` (text 1..1000, transactional public doc + private `confessionAuthors/{id}` author record, audited, returns `{id}`), `deleteConfession` (author-only via private record), `moderateConfession` (staff owner/admin/moderator: quarantine/restore/delete, audited), `listConfessionQueue` (staff-only, quarantined items, returns id/text/createdAt/status — never uid).
- `firestore.rules` (backend) — `confessionAuthors/{id}`: client read/write denied (callable-only). `confessions/{id}`: signed-in read only when `status=='visible'`; client write denied. Nested `supports/{uid}` (create/delete own, keys `['uid']`) and anonymous `comments/{id}` (keys only `['text','createdAt']`, no uid/author allowed). Confessions flow through the same quarantine/audit approach as gallery moderation.
- `functions/confessions.test.js` (NEW) — 4 unit tests (create validation, author-only delete, staff-only moderate, queue privacy); added to `package.json` test script.

## 5. Comment & Reply Restructuring (threaded + likes)
- `js/app.js` (`openGalleryEngagement`) — flat comment list replaced with threaded render: walks existing `replyTo` chain to root, top-level comments first; replies nested (indented `.gallery-comment-thread`) under a "Show N replies" / "Hide replies" collapse toggle (collapsed by default, auto-expands after you post a reply). Existing `replyTo`/`replyToName` linkage preserved (no new parentId field). New shared `buildCommentArticle` renderer adds a per-comment heart-like button + count backed by `comments/{commentId}/likes/{likerUid}` subcollection (toggle set/delete, one like per user). Existing Reply / Delete / Edit / Copy / ⋯ menu behavior preserved.
- `css/redesign.css` — `.gallery-comment-thread`, `.gallery-comment-replies-toggle`, `.gallery-comment-like-row`, `.gallery-comment-like`, `.gallery-comment-like-count`.
- `firestore.rules` (backend) — added nested `match /likes/{likerId}` under gallery comments (read = shared post or owner; create = shared + liker + keys `['uid']`; delete = liker or owner; update false), mirroring post likes.

---

### Files changed
- `index.html`, `js/app.js`, `css/redesign.css` (frontend; `css/site.css` untouched)
- `firestore.rules` (additive only)
- `functions/index.js` (one wiring line), `functions/confessions.js` (new), `functions/confessions.test.js` (new), `functions/package.json` (test script)
- `CHANGELOG.md` (this file)
