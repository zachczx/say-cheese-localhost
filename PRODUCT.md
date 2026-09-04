# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vanilla TypeScript, HTML, and CSS packaged as a locally installed Chrome Manifest V3 extension. Use Vite for builds, Vitest for unit tests, ESLint for linting, and pnpm for dependency management. Do not add a frontend framework unless the controller becomes materially more complex.

## Users

The primary user is a developer or portfolio owner capturing a curated, repeatable set of screens from applications running on localhost. They start the target application's safe screenshot environment, choose a project profile and viewport, run an ordered capture job, then manually review and promote approved images.

## Product Purpose

Say Cheese Localhost turns declarative application-route profiles into portfolio-ready screenshots. Success means a user can capture an entire approved shot list at deterministic viewport settings, understand progress and failures, and receive reviewable files in Chrome's Downloads directory without exposing private data.

## Positioning

Say Cheese Localhost is a focused capture controller for local applications: project profiles describe routes and preparation steps as data, while the extension uses Chrome DevTools Protocol directly for deterministic navigation, emulation, readiness, privacy-safe request replacement, and capture.

## Operating Context

- The extension is loaded unpacked from its `dist` directory and opened as a persistent controller page.
- The target application is started separately by the user; the extension never starts local processes.
- A dedicated Chrome window runs captures sequentially so controller state remains visible.
- Output is downloaded beneath `Downloads/say-cheese-localhost/<profile>/` for deliberate human review.
- Cubby is the first integration, with Lingo, BTOnomics, Apptitude, and other applications intended to be added through profiles later.

## Capabilities and Constraints

- Chrome Manifest V3 with `debugger`, `downloads`, and `storage` permissions; avoid broad host permissions.
- Project profiles are validated data and cannot execute arbitrary JavaScript.
- Initial viewport presets are phone (390 x 844 at DPR 3), tablet (768 x 1024 at DPR 2), and desktop (1440 x 1000 at DPR 1).
- Captures support ordered readiness checks and declarative actions, bounded timeouts, continue-on-error, retry, stop, and reliable debugger cleanup.
- Captures bypass service workers, pin the timezone to Asia/Singapore, disable motion and caret rendering, and reset scroll position unless a shot says otherwise.
- No production databases, production authentication cookies, automatic repository writes, native messaging, video capture, or screenshot comparison infrastructure.
- Cubby capture must refuse to run unless its development-only preflight marker confirms screenshot mode and redacted data.
- Requests for personal image hosts must be intercepted before they reach the origin and replaced deterministically with bundled profile assets.

## Brand Commitments

- Product and extension name: Say Cheese Localhost.
- Voice: concise, direct, and operational.
- The controller should feel like a native developer tool in a warm-light theme. Photographic character is welcome only where it helps users understand capture work.

## Evidence on Hand

The implementation brief defines the capture workflow, Chrome architecture, profile model, viewport presets, initial Cubby shot manifest, privacy guarantees, testing requirements, migration phases, and completion criteria. No public marketing claims, testimonials, or production usage evidence should be invented.

## Product Principles

- Safety is a prerequisite, not a warning: unsafe or unverified capture environments are refused.
- Profiles stay declarative and project-specific while the capture engine stays reusable.
- Every long-running action exposes clear state, recovery, and cleanup behavior.
- Deterministic output matters more than hidden automation or format continuity.
- Promotion into a portfolio remains a deliberate human review step.

## Accessibility & Inclusion

The controller must be fully usable by keyboard, expose status changes accessibly, maintain readable contrast, and not rely on color alone for shot or job state.
