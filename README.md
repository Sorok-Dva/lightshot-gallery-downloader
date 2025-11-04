# Lightshot Gallery Downloader

Modern Chrome extension that downloads every screenshot from your Lightshot gallery and packages them in a single ZIP archive.

The 2025 refactor ships a TailwindCSS-driven control panel, smarter throttling, and a dedicated credits page that introduces the project and its successor, **ScreenMe**.

## Highlights
- Manifest V3 service worker orchestrates the download pipeline with cancellation support.
- TypeScript codebase with modular architecture (background, content UI, domain client, shared utilities).
- Concurrency control to balance speed and stability while fetching thousands of screenshots.
- Automatic retry with exponential backoff and adaptive throttling (sequential mode by default for large galleries).
- Sleek Tailwind-powered control panel with live progress, logging, and quick recovery actions.
- Action button + credits page describing the project roadmap and the upcoming ScreenMe platform.

## Quick Start
1. Install dependencies: `npm install`
2. Build the extension: `npm run build`
3. Load the unpacked build from the `dist/` folder via `chrome://extensions`
4. Click the extension icon to open the credits page and confirm permissions
5. Navigate to `https://prnt.sc/gallery.html`, click **Download gallery** and let the panel drive the workflow

## Development
- `npm run dev` — watch build with incremental esbuild rebuilds (esbuild + Tailwind watch)
- `npm run lint` — run ESLint (single quotes, no semicolons)
- `npm run typecheck` — run TypeScript strict checks
- `npm run clean` — remove the `dist/` output

The build pipeline bundles `src/background/index.ts` and `src/content/index.ts` with esbuild, compiles TailwindCSS from `src/styles/tailwind.css`, loads declarative net-request rules for CORS fixes, and copies `manifest.json`, assets, and credits into `dist/`.

## Architecture Notes
- `src/domain/lightshotClient.ts` — JSON-RPC Lightshot API client with pagination helpers
- `src/background/downloadService.ts` — coordinates downloads, throttling, ZIP generation, and Chrome downloads API
- `src/content/index.ts` — mounts the UI panel, mediates background communication, handles cancel/retry flows, and links to credits
- `src/content/ui/panel.ts` — Tailwind-styled panel with sequential mode toggle, throttling controls, and logging
- `src/shared/throttler.ts` — concurrency limiter reused by the background worker

You can tweak the default concurrency from the panel (1–10) or keep sequential mode (default) for maximum stability. The service worker streams progress, warnings, and completion events back to the UI so the user never loses track of what is happening in the background.
