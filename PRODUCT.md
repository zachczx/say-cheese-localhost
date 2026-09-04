# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Svelte 5, TypeScript, HTML, and CSS packaged as a locally installed Chrome Manifest V3 extension. The controller is a small client-only Svelte application; the background worker, capture engine, profiles, and storage remain plain TypeScript. Use Vite for builds, Vitest for unit tests, ESLint for linting, and pnpm for dependency management. Do not add SvelteKit, client-side routing, or a server runtime without a separate product need.

## Users

The primary user is a developer or portfolio owner capturing a curated, repeatable set of screens from applications running on localhost. They start the target application's safe screenshot environment, choose a project profile and viewport, prepare and capture each view at their own pace, then manually review and promote approved images.

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
- Viewport presets cover iPhone 14 Pro Max (430 x 932 at DPR 3, the default),
  standard and compact iPhones, Android, tablet, laptop, and desktop sizes.
- Captures support ordered readiness checks and declarative actions, bounded timeouts, continue-on-error, retry, stop, and reliable debugger cleanup.
- Captures bypass service workers, pin the timezone to Asia/Singapore, disable motion and caret rendering, and preserve manual framing; only batch preparation resets scroll.
- No production databases, production authentication cookies, automatic repository writes, native messaging, video capture, or screenshot comparison infrastructure.
- Cubby defaults to its synthetic QA server on 127.0.0.1:5174. The user verifies its seed before capture; automated preflight is not required for this manual workflow.
- Cubby QA serves seeded photos locally. Generic request replacements remain available for profiles that need them.

## Brand Commitments

- Product and extension name: Say Cheese Localhost.
- Voice: concise, direct, and operational.
- The controller should feel like a native developer tool in a warm-light theme. Photographic character is welcome only where it helps users understand capture work.

## Evidence on Hand

The implementation brief defines the capture workflow, Chrome architecture, profile model, viewport presets, initial Cubby shot manifest, privacy guarantees, testing requirements, migration phases, and completion criteria. No public marketing claims, testimonials, or production usage evidence should be invented.

## Product Principles

- Keep capture local and use a verified synthetic QA environment. The tool does not prove database isolation; human review remains required.
- Profiles stay declarative and project-specific while the capture engine stays reusable.
- Every long-running action exposes clear state, recovery, and cleanup behavior.
- Deterministic output matters more than hidden automation or format continuity.
- Promotion into a portfolio remains a deliberate human review step.

## Accessibility & Inclusion

The controller must be fully usable by keyboard, expose status changes accessibly, maintain readable contrast, and not rely on color alone for shot or job state.
