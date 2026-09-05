# Say Cheese Localhost

Say Cheese Localhost is a locally installed Chrome Manifest V3 extension for capturing curated localhost routes at deterministic viewport sizes. Profiles remain declarative data; the extension uses Chrome DevTools Protocol directly for navigation, preparation, and capture.

The controller is a client-only Svelte application built directly with Vite. The background
worker, capture engine, profiles, storage, and fixture remain framework-independent TypeScript
or HTML; the extension does not use SvelteKit or client-side routing.

The current milestone includes the generic local fixture and the curated Cubby
route profile. Use Cubby against its synthetic, manually verified QA environment. The capture tool does not start the app or seed its database.

## Requirements

- Chrome 116 or newer
- Node.js 22 or newer
- pnpm 11.19.0

## Install and build

```powershell
pnpm install
pnpm build
```

The unpacked extension is written to `dist`.

## Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's `dist` directory.
5. Select the Say Cheese Localhost toolbar action to open the persistent controller.

The extension requests only `debugger`, `downloads`, and `storage`. It deliberately does not request broad host or tab-reading access.

## Prove the local fixture

Build once, then serve the generated fixture:

```powershell
pnpm preview
```

The default Local demo profile points to `http://localhost:5173`. In the controller:

1. Keep the Phone viewport selected.
2. Select one or both fixture shots.
3. Choose **Open**, prepare the capture window, then choose **Capture current view**.
4. Choose **Next shot / finish** when satisfied. You can capture again to overwrite the image without resetting its framing.
5. Review the files under `Downloads/say-cheese-localhost/demo/`.

The default iPhone 14 Pro Max output should be exactly `1290 × 2796` from a
`430 × 932` CSS viewport at 3× DPR. WebP quality must be assessed visually in
Chrome before the format is adopted for application profiles; use lossless PNG
instead if artifacts are visible.

## Development

```powershell
pnpm dev
```

This rebuilds the unpacked extension when files change. Reload the extension from `chrome://extensions` after a rebuild.

Run the complete local validation suite with:

```powershell
pnpm run ci
```

## Profile safety

- Base URLs are restricted to `localhost`, `*.localhost`, `127.0.0.1`, and `[::1]`.
- Shot and preflight paths must remain on the selected base origin.
- Output paths must remain beneath Chrome's Downloads directory.
- Profiles cannot execute arbitrary JavaScript.
- Matching private-image requests are paused before the network layer and must be fulfilled from bundled assets or explicitly failed.
- Service workers are bypassed during capture.
- A profile with a preflight rule cannot capture unless the returned JSON matches every required marker.

Bundled replacement assets belong under `public/profiles/<profile>/assets/`; Vite copies that tree into the extension package.

## Capture lifecycle

Every job creates a dedicated Chrome window, applies viewport and timezone emulation, and processes shots in order. **Prepare each shot manually** is on by default. Navigate, expand sections, and scroll in the capture window, then return to the controller and choose **Capture current view**. Retakes preserve that view. Human preparation has no deadline; navigation and capture operations have bounded deadlines. Stop or closing the target ends the session and cleans up the debugger.

Turn off manual preparation to use the existing batch route/actions flow. Only batch preparation sweeps the document and resets scroll. Manual capture checks images in the capture area without moving the page. Failed images block saving; page exceptions and failed local API requests appear as warnings for human review. A saved image still needs visual inspection.

By default, a completed or stopped job closes its capture window. Users may retain the window after a failure for inspection. Debugger detachment and emulation cleanup still occur before the window is retained.

## Capture Cubby QA

In `A:\cubby`, configure a disposable **screenshot QA database** in `.env.test.local`.
Keep it separate from the integration test database: integration tests reset their database.
Then run these commands explicitly:

```powershell
just seed-test-db
just verify-test-db
just dev-test
```

`seed-test-db` wipes the configured test database. Run it only when you intend to rebuild that disposable QA dataset. `verify-test-db` is read-only; if the seed is missing, prepare the database before capturing.

Select **Cubby** in Say Cheese. Its default is `http://127.0.0.1:5174`; existing customized URLs remain unchanged. Confirm the synthetic household in the app before capture. Localhost itself is not proof that an application uses safe data, and this profile does not perform an automated QA preflight.

Presets are starting points. For Shelf, scroll Home to the Shelf. For gym shots, open the workout or exercise you want to show before capturing. The controller displays preparation hints. Keep manual preparation enabled for these views; batch mode captures their starting routes.

Review files in Downloads before publishing them, particularly when using a private QA photo directory. Do not point this profile at production-backed development.

The public Cubby case study currently consumes these 17 screenshots, in this
editorial order:

1. `dashboard` — `/app`
2. `shelf` — `/app`
3. `tasks` — `/app/tasks`
4. `limits` — `/app/limits`
5. `screentimer` — `/app/screentimer`
6. `enrichment` — `/app/enrichment`
7. `gym-workout` — `/app/gym`, then drill into the first workout
8. `gym-exercise` — `/app/gym/stats/exercises`, then drill into the first exercise
9. `illness` — `/app/illness`
10. `coffee` — `/app/coffee`
11. `meals` — `/app/meals`
12. `expiry` — `/app/expiry`
13. `market` — `/app/market`
14. `finance` — `/app/finance`
15. `travel` — `/app/travel`
16. `growing-up` — `/app/growing-up`
17. `journal-recap` — `/app/journal/recap`

The hand-editable source of truth is `src/profiles/cubby/manifest.json`; a thin
TypeScript adapter validates it against the same schema as every other profile.
Each build also copies it to `dist/profiles/cubby/manifest.json` as standalone
JSON.
The Cubby profile is registered in the controller, so selecting **Cubby** shows
the complete route queue. Use it with the verified synthetic QA environment described above.

Captured files use the project-prefixed editorial sequence
`cubby-01-dashboard.webp` through `cubby-17-journal-recap.webp`, so their order
and source remain clear outside the output folder.
