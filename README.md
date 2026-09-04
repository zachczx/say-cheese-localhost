# Say Cheese Localhost

Say Cheese Localhost is a locally installed Chrome Manifest V3 extension for capturing curated localhost routes at deterministic viewport sizes. Profiles remain declarative data; the extension uses Chrome DevTools Protocol directly for navigation, preparation, and capture.

The current milestone includes the generic local fixture and the curated Cubby
route profile. Use Cubby only against a verified redacted local environment
until its automated preflight and private-photo replacements are complete.

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
3. Choose **Capture**.
4. Review the files under `Downloads/say-cheese-localhost/demo/`.

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
pnpm ci
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

Every job creates a dedicated Chrome window, attaches one debugger session, enables the required CDP domains, applies viewport and timezone emulation, and processes shots in order. Each shot has a 45-second overall deadline and 15-second readiness defaults. Stop, failure, target closure, and external debugger detachment all pass through the same cleanup path.

Before route-specific framing, capture preparation briefly sweeps the document
to trigger lazy-rendered content and images, then returns to the top. This keeps
the main route deterministic without requiring someone to scroll the capture
window manually.

By default, a completed or stopped job closes its capture window. Users may retain the window after a failure for inspection. Debugger detachment and emulation cleanup still occur before the window is retained.

## Before capturing production Cubby data

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
the complete route queue. Registration does not make a production-data capture
safe; use a verified redacted local environment.

Captured files use the project-prefixed editorial sequence
`cubby-01-dashboard.webp` through `cubby-17-journal-recap.webp`, so their order
and source remain clear outside the output folder.

Do not capture production Cubby data until all of the following are available:

- the development-only screenshot status endpoint;
- a verified redacted screenshot environment;
- the narrow stable selectors required by dynamic shots;
- every replacement image bundled beneath `public/profiles/cubby/assets/`;
- an automated assertion that replacement failures fail the shot;
- manual verification that no R2 or Unsplash request reaches its original host.
