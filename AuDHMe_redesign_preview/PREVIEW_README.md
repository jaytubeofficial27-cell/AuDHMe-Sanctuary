# AuDHMe redesign preview

This is a separate, modular draft of the AuDHMe Sanctuary site. It carries the original site content into a whole-site visual system with a warm charcoal palette, soft cream text, grouped responsive navigation, a focused home-page hero and destination grid, and consistent modular page surfaces. Member profiles use a full-width identity header with a structured content column and details sidebar. The Store has a simple two-item catalog with separate Core and Spectrum hoodie detail routes; each detail view supports size and colour selection before adding to the basket. Product images fit within their detail panels rather than being cropped into catalog cards. The Neuroverse no longer contains an apparel roadmap card or an empty duplicate divider; Neuro-Code series use consistent compact spacing and topic filters.

Optional reading preferences for warm tone, reduced motion, low-stim reading, and text spacing remain available in Sensory Tools. The site also supports temporary, opt-in Neuro-Code adaptations: after flipping a code, visitors can open its separate “Adapt site” action. Each code now presents only its own relevant set of interface actions rather than a shared set of generic checkboxes. Depending on the code, these can include a quiet screen, a one-series view, larger controls, a visible/copyable need statement, sensory-tool access, a one-step task prompt, or an optional focus timer. Visitors can change selections before applying or restore the original site. Choices stay in page memory, not in an account. The Neuro-Pass offers the same opt-in flow.

When live local weather is selected, weather particles remain still while location and current conditions load. If the request fails or takes more than 12 seconds, the seasonal atmosphere is used instead; the weather controls show the status.

Seasonal and holiday effects are individually enabled or disabled in Sensory Tools and follow the calendar when enabled. Existing manual selections return to calendar mode; an existing disabled holiday stays disabled. Weather controls remain independent; seasonal weather and the live-weather fallback use a neutral clear effect when seasons are disabled, unless an enabled holiday supplies its own effect.

The signed-in founder can open Admin settings on their own profile to preview time of day, seasons, holidays and weather in the current browser, and see local live-weather status and errors. The seasonal weather option simulates weather for the previewed season and holiday. Previews never change shared settings, reset on reload or sign-out, and respect sensory and motion settings. This is a local visual preview, not server-side administrator authorization; the Christmas countdown continues to use the real date.

Christmas uses a stationary postcard-inspired design with a window into a decorated living room, a seasonal home welcome, evergreen-and-bauble garland in the navigation, and gift-wrapped Neuro-Code and condition cards with code-and-title tags. The existing Christmas countdown is retained. Weather remains independently selectable, and paused animation, low-stimulation and reduced-motion preferences hide the added festive treatment.

Neuro-Code cards remain unchanged as communication cards. Their suggested adaptations are optional site-interface preferences, not medical recommendations or assumptions about what a person needs.

New profiles are shared with signed-in Sanctuary members by default; existing profile privacy settings are preserved. A private profile hides its entire gallery. When a profile is shared, individually private gallery items remain hidden.

## Important

This is a review draft. It has not been deployed, and the Firebase rules/functions have not been applied. The backend setup file contains commands that target the project ID currently in the code. Before any backend deployment, confirm a dedicated preview Firebase project and update all project-specific values. Do not run those commands against the live project as a preview step.

## Files

- `index.html` — site markup and Firebase client configuration.
- `css/site.css`, `css/redesign.css` — extracted original styles and the complete redesign layer.
- `js/app.js` — browser behavior, authentication, profile/gallery, directory, basket.
- `firestore.rules`, `storage.rules`, `storage-cors.json` — backend privacy and upload configuration.
- `functions/` — Stripe callable functions and webhook.
- `BACKEND_SETUP.md` — backend setup notes and prerequisites.

## Checks completed

JavaScript syntax, HTML duplicate IDs, and CSS brace balance passed. Browser checks verified that different Neuro-Codes show distinct relevant action sets, the one-step prompt and focus timer are code-specific and optional, actions apply only after confirmation, reset removes temporary effects, and mobile layout has no horizontal overflow at 390px. Existing Neuro-Code content remains in place. Earlier preview checks covered the Neuro-Pass flow, responsive navigation, and profile layout using local data. Firebase Rules emulator validation was not available. No deployment was performed.
