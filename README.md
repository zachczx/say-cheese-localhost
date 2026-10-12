# Say Cheese Localhost

Say Cheese Localhost is a locally installed Chrome Manifest V3 extension for capturing curated localhost routes at deterministic viewport sizes. Profiles remain declarative data; the extension uses Chrome DevTools Protocol directly for navigation, preparation, and capture.

The controller is a client-only Svelte application built directly with Vite. The background
worker, capture engine, profiles, storage, and fixture remain framework-independent TypeScript
or HTML; the extension does not use SvelteKit or client-side routing.

Two profiles ship today: the local fixture demo and Cubby. The capture tool never starts an
application or seeds its database. Cubby's QA setup and shot list live in
[`src/profiles/cubby/README.md`](src/profiles/cubby/README.md).

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

The extension requests the `debugger`, `downloads`, and `storage` permissions. Its host access
is limited to localhost and loopback origins, which the Base URL connection check uses. It
deliberately does not request broad host or tab-reading access.

## Prove the local fixture

Build once, then serve the generated fixture:

```powershell
pnpm preview
```

The default Local demo profile points to `http://localhost:5173`. In the controller:

1. Keep the Phone viewport selected.
2. Select one or both fixture shots.
3. Choose **Open**, prepare the capture window, then choose **Capture current view**.
4. Choose **Retake current view** to overwrite the image without resetting its framing, or
   **Skip shot** to move on without saving.
5. Choose **Next shot**, or **Finish** on the last shot.
6. Review the files under `Downloads/say-cheese-localhost/demo/`.

The default iPhone 14 Pro Max output is exactly `1290 × 2796` from a `430 × 932` CSS viewport
at 3× DPR, and native zoom does not change it. The end-to-end suite verifies both. WebP quality must be assessed visually in
Chrome before the format is adopted for application profiles; use lossless PNG
instead if artifacts are visible.

## Development

```powershell
pnpm dev
```

This rebuilds the unpacked extension when files change. Reload the extension from `chrome://extensions` after a rebuild.

The build stamps the extension version from `package.json` into `dist/manifest.json`. Bump the version there only.

Run the complete local validation suite with:

```powershell
pnpm run ci
```

Unit tests mock Chrome DevTools Protocol. The end-to-end suite loads the built extension into
Playwright's Chromium, serves the fixture, and checks real output dimensions for batch, zoomed,
full-page, and manual captures:

```powershell
pnpm exec playwright install chromium
pnpm e2e
```

Branded Chrome 137 and newer ignores `--load-extension`, so the suite uses Playwright's Chromium.

## Add a profile

Profiles are JSON manifests. The build bundles every `src/profiles/<folder>/manifest.json`,
so adding a project means adding a folder and rebuilding:

1. Copy `src/profiles/demo/manifest.json` to `src/profiles/<folder>/manifest.json`.
2. Set a unique `id`, a `label`, the `defaultBaseUrl`, an `outputDirectory` beneath
   `say-cheese-localhost/`, and the ordered `shots`.
3. Optionally set `order` to position it in the project list. Lower numbers come first,
   and profiles without one sort last by label.
4. Run `pnpm build` and reload the extension.

The build fails with the manifest path and every problem if a profile is invalid or reuses
another profile's `id`. Each build also copies the manifests to `dist/profiles/<folder>/`.
[`docs/profiles.md`](docs/profiles.md) documents every field, including timeouts, readiness
conditions, and batch actions. A profile may keep its own `README.md` beside its manifest.

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

Every job creates a dedicated Chrome window, applies viewport, native tab zoom, and timezone emulation, and processes shots in order. Native zoom accepts exact values such as 220% even when the browser's zoom menu skips them. **Prepare each shot manually** is on by default. Navigate, expand sections, and scroll in the capture window, then return to the controller and choose **Capture current view**. Retakes preserve that view. Human preparation has no deadline; navigation and capture operations have bounded deadlines. Stop or closing the target ends the session and cleans up the debugger.

Profiles can tune those deadlines with an optional `timeouts` object. See
[`docs/profiles.md`](docs/profiles.md#timeouts) for the fields and defaults.

Turn off manual preparation to use the existing batch route/actions flow. Only batch preparation sweeps the document and resets scroll. Manual capture checks images in the capture area without moving the page. Failed images block saving; page exceptions and failed local API requests appear as warnings for human review. A saved image still needs visual inspection.

Enable **Capture full page** to sweep lazy content, restore the prepared scroll position, and capture the complete document as one continuous WebP. Full-page output keeps the selected viewport width and has a variable height based on the rendered document.

Under **Advanced**, **Render beyond the viewport** lays the page out at its full height while
capturing the current view. Try it if content is clipped. Fixed top and bottom bars may move.

By default, a completed or stopped job closes its capture window. Users may retain the window after a failure for inspection. Debugger detachment and emulation cleanup still occur before the window is retained.
