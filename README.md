# MakiNuki runtime-web

Browser runtime for MakiNuki WASM scraper plugins (`@makinuki/runtime-web`). It loads registry manifests, verifies and executes `.wasm` plugins via Extism, and routes network access through a selected transport: direct browser fetch, the companion extension bridge, or a worker proxy relay.

- Plugins run sandboxed in WASM (WebAssembly JSPI); host functions provided under the `makinuki` namespace
- Zero runtime dependencies shipped

## Install and build

```sh
pnpm install
pnpm build      # tsdown -> dist/index.js + dist/index.d.ts
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest hermetic unit tests (no network)
```

## Usage

```js
import { MakiNukiRuntime } from "@makinuki/runtime-web";

const runtime = new MakiNukiRuntime({
  registryUrl: "https://makinuki.github.io/index.json",
  transport: {
    pin: "direct", // "direct" | "companion" | "worker"
  },
  validate: false, // JSON schema validation (Node-only for now)
});

const index = await runtime.registryIndex(); // fetch + SHA-256 keys are checked at loadSource
const source = await runtime.loadSource("mangadex");

const { items } = await source.search({ query: "Bokutachi wa Hanshoku wo Yameta", page: 1 });
const details = await source.getDetails(items[0].id);
const pages = await source.getPages(details.chapters[0].id);
const blob = await source.fetchImage(pages[0]); // transport-aware image bytes

await source.close();
await runtime.close();
```

## Source settings

Sources may declare user-configurable settings through the optional `get_settings` export. The runtime probes the export at load and exposes it on the loaded source:

```js
const source = await runtime.loadSource("mangadex");

source.hasSettings;                             // true when the plugin declares settings
const settings = await source.getSettings();    // SettingSchema[]

await source.setSetting("data_saver", true);                   // checkbox: boolean
await source.setSetting("base_url", "https://mirror.example"); // text: raw string
await source.isSettingSet("base_url");                         // true
await source.getSettingValue("base_url");                      // stored raw value (non-sensitive only)
await source.setSetting("base_url", null);                     // reset: deletes the key
```

Values are written into the plugin's per-source storage namespace, so the plugin reads them back through `makinuki_storage_get` at call time. `select` values must be one of the declared options, every write is checked against the declared setting and the 64 KB storage cap, and a missing key means the declared default applies. Sensitive (`sensitive: true`) values are never returned; use `isSettingSet` for those. Custom `StorageAdapter` implementations must provide `delete()` to support resets.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/registry.ts` | Fetch and parse the registry manifest |
| `src/plugin.ts` | Load a `.wasm` plugin, run exports, wrap results in `PluginResult<T>` |
| `src/host-functions.ts` | `makinuki_fetch`, `makinuki_storage_get`, `makinuki_storage_set`, `makinuki_log` adapters |
| `src/settings.ts` | Setting declarations lookup and value serialization |
| `src/transport.ts` | Pinned transport manager (direct / companion / worker), mode detection |
| `src/worker-client.ts` | HTTP relay client for the worker proxy (envelope parsing, URL normalization) |
| `src/companion.ts` | Messaging client for the companion browser extension |
| `src/storage.ts`, `src/unscramble.ts` | Per-source key-value storage, encrypted-image unscrambling helpers |
| `src/validate.ts` | JSON Schema validation against `@makinuki/spec/schemas` (Node-only) |

## Development and testing

### Quickstart

```sh
pnpm install
pnpm build
pnpm serve          # static server on http://127.0.0.1:5173
```

Open `http://127.0.0.1:5173/` (serves `examples/demo.html`). Pick a transport mode (direct, companion or worker) in the dropdown; a status panel shows the active tier, a companion ping badge, and streams images both through direct `<img>` tags and blob URLs from `fetchImage` via the "Stream all" button. Runtime logging goes to the browser console (prefix `[harness]`); the `pnpm serve` terminal logs every request (method, status, latency, bytes).

Requires a browser with WASM JSPI support.

### Transport mode verification

The registry sources served by MakiNuki are CORS-blocked by default, so each transport exists to prove a different path. Verify all three:

1. **Direct mode** (browser-native fetch, no worker or extension)
   - Browser direct requests are subject to upstream CORS.

2. **Companion extension mode** (zero-CORS requests through the bridge)
   - Load the unpacked extension from your browser's extension manager (developer mode > Load unpacked) and pick `companion-extension/`.
   - Open the extension popup and click "Connect (grant host access)".
   - In the demo page select `companion` and use the Ping button in the transport panel until the badge shows `connected`.
   - Run a search and stream a page. After editing extension source, reload the extension card and refresh the page.

3. **Worker proxy mode** (relay behind a Cloudflare Worker)
   - From `worker-proxy/`: `pnpm wrangler dev --port 8787 --local false`.
   - The worker reads local dev settings from `.dev.vars` (Wrangler's standard local env file); `CLIENT_ORIGINS` there must include `http://127.0.0.1:5173` (the demo page origin), then restart the worker.
   - In the demo page select `worker`, keep the proxy URL `http://127.0.0.1:8787` and set the token from the worker's `CLIENT_TOKEN`.
   - A deployed worker URL works the same way: paste it into the proxy field with its token.

### Automated vs. manual testing

| Tool | Command | Scope |
| --- | --- | --- |
| Vitest | `pnpm test` | Hermetic unit tests. Mocked fetch and messaging, no network. |
| E2E driver | `pnpm e2e` | Full pipeline against the real registry and upstreams in Node (WASM JSPI). Pins `direct` or `worker`; companion is browser-only. |
| Demo harness | `pnpm serve` | Manual browser verification including the companion extension, worker relay, ping handshake and blob image streaming. |

`pnpm e2e` flags: `--registry <url>`, `--source <id>`, `--pin direct|worker`, `--proxy <url>`, `--token <token>`, `--search <q>`, `--details <id>`, `--pages <id>`, `--latest`, `--image <n>`, `--validate`, `--help`. Example:

```sh
pnpm e2e --search "Yosuga no Sora" --details --pages --image 0 --latest
pnpm e2e --search "Bokutachi wa Hanshoku wo Yameta" --details
pnpm e2e --pin worker --proxy http://127.0.0.1:8787/proxy --token dev-token --search solo
```
