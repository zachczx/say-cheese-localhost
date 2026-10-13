# Profile reference

A profile is a JSON manifest at `src/profiles/<folder>/manifest.json`. The build bundles every
manifest and validates it against `src/profiles/schema.ts`. Validation errors stop the build
and name the manifest. `src/profiles/demo/manifest.json` is a small working example.

## Profile fields

| Field                 | Required | Description                                                                                  |
| --------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `id`                  | Yes      | Unique identifier. Saved settings are keyed by it, so avoid renaming it.                     |
| `label`               | Yes      | Name shown in the project list.                                                              |
| `order`               | No       | Integer position in the project list. Lower comes first; profiles without one sort last.     |
| `defaultBaseUrl`      | Yes      | HTTP or HTTPS URL. The controller only accepts localhost and loopback addresses.             |
| `baseUrlHint`         | No       | 1–160 characters of help shown under the Base URL field.                                     |
| `outputDirectory`     | Yes      | Folder beneath Chrome's Downloads directory, for example `say-cheese-localhost/demo`.        |
| `defaultViewport`     | Yes      | Viewport preset ID from `src/profiles/viewports.ts`, for example `phone`.                    |
| `timeouts`            | No       | Per-stage deadlines. See [Timeouts](#timeouts).                                              |
| `preflight`           | No       | A same-origin JSON endpoint that must match `expected` values before any capture starts.     |
| `requestReplacements` | No       | Image URL patterns to fulfill from bundled assets under `public/profiles/<profile>/assets/`. |
| `shots`               | Yes      | Ordered list of shots. See [Shot fields](#shot-fields).                                      |

## Shot fields

| Field              | Required | Description                                                                                                         |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`               | Yes      | Unique within the profile, compared case-insensitively.                                                             |
| `label`            | Yes      | Name shown in the shot queue.                                                                                       |
| `path`             | Yes      | Same-origin absolute path, for example `/app/tasks?view=week`.                                                      |
| `filename`         | Yes      | Output file name ending in `.webp`, unique within the profile. No folders.                                          |
| `enabledByDefault` | Yes      | Whether the shot starts selected.                                                                                   |
| `preparation`      | No       | Hint shown while the user prepares the shot manually.                                                               |
| `ready`            | No       | Batch mode only. Conditions to wait for: `selector` or `url` (with `*` wildcards).                                  |
| `actions`          | No       | Batch mode only. Ordered steps: `wait-for-selector`, `click`, `select-index`, `scroll-to`, `wait-for-url`, `delay`. |
| `capture`          | No       | `mode` of `viewport`, `full-page`, or `element` (with `selector`), and `captureBeyondViewport`.                     |
| `settleMs`         | No       | Batch mode only. Extra delay before capturing.                                                                      |

Profiles cannot run arbitrary JavaScript. Actions are limited to the declarative list above.

## Timeouts

Each value is in milliseconds, from 1,000 to 600,000. The stage deadlines cannot exceed
`shotMs`. Human preparation in manual mode never times out. These are the defaults:

```json
"timeouts": { "shotMs": 45000, "navigationMs": 15000, "networkQuietMs": 15000, "assetsMs": 15000 }
```

- `shotMs` bounds opening, preparing, capturing, and downloading one shot.
- `navigationMs` bounds navigation until the page's load event.
- `networkQuietMs` bounds waiting for local document, script, and API requests to settle.
- `assetsMs` bounds fonts and visible images loading and decoding.
