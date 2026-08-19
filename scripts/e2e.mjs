import { MakiNukiRuntime } from "../dist/index.js";

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  }
  if (!arg.startsWith("--")) continue;
  const eq = arg.indexOf("=");
  if (eq !== -1) {
    args.set(arg.slice(2, eq), arg.slice(eq + 1));
    continue;
  }
  const next = process.argv[i + 1];
  if (next !== undefined && !next.startsWith("--")) {
    args.set(arg.slice(2), next);
    i++;
  } else {
    args.set(arg.slice(2), undefined);
  }
}

function printHelp() {
  console.log(`MakiNuki runtime-web E2E driver (Node, WASM JSPI)

Usage: pnpm e2e [flags]

Registry / source
  --registry <url>      Registry manifest URL (default: https://makinuki.github.io/index.json)
  --source <id>         Source plugin id (default: mangadex)

Transport (pin one mode; direct by default)
  --pin <mode>          direct | worker   (companion is unavailable in Node)
  --proxy <url>         Worker proxy URL, e.g. http://127.0.0.1:8787/proxy
  --token <token>       Client token for the worker proxy
  --origin <origin>     Origin header sent with worker requests

Pipeline steps
  --search <query>      Search query (default: empty string)
  --page <n>            Search page number (default: 1)
  --details <id>        Manga id for get_details (default: first search item)
  --pages <id>          Chapter id for get_pages (default: first chapter; --latest uses last)
  --latest              Use the newest chapter for get_pages
  --image <n>           fetchImage page index; tries up to 3 consecutive pages

Validation
  --validate            Validate payloads against the spec JSON Schemas (Node-only)

Examples
  pnpm e2e --search "Yosuga no Sora" --details --pages --image 0 --latest
  pnpm e2e --search "Bokutachi wa Hanshoku wo Yameta" --details   (chapter-less on MangaDex)
  pnpm e2e --pin worker --proxy http://127.0.0.1:8787/proxy --token dev-token --search solo
  pnpm e2e --validate --search "Yosuga no Sora"

Requires Node with --experimental-wasm-modules --experimental-wasm-jspi
(enabled by the pnpm e2e script). Exit code 0 on full pass, 1 on any failure.`);
}

const flag = (name, fallback) => (args.has(name) ? args.get(name) : fallback);

const REGISTRY = flag("registry", "https://makinuki.github.io/index.json");
const SOURCE_ID = flag("source", "mangadex");
const PROXY_URL = flag("proxy", "http://127.0.0.1:8787/proxy");
const CLIENT_TOKEN = flag("token", undefined);
const ORIGIN = flag("origin", undefined);
const PIN = flag("pin", undefined);
const VALIDATE = args.has("validate");
const QUERY = flag("search", "");
const PAGE = Number(flag("page", "1"));
const DETAILS_ID = flag("details", undefined);
const PAGES_ID = flag("pages", undefined);
const LATEST = args.has("latest");
const FETCH_IMAGE_INDEX = flag("image", undefined);

let failures = 0;

function pass(label) {
  console.log(`PASS ${label}`);
}

function fail(label, detail) {
  failures++;
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ""}`);
}

function check(cond, label, detail) {
  if (cond) pass(label);
  else fail(label, detail);
}

const transport = { companion: false };
if (PIN === "direct") {
  transport.direct = true;
  transport.worker = false;
} else if (PIN === "worker") {
  transport.direct = false;
  transport.worker = true;
  transport.proxyUrl = PROXY_URL;
  if (CLIENT_TOKEN) transport.clientToken = CLIENT_TOKEN;
  if (ORIGIN) transport.origin = ORIGIN;
} else {
  transport.direct = true;
  transport.worker = true;
  transport.proxyUrl = PROXY_URL;
  if (CLIENT_TOKEN) transport.clientToken = CLIENT_TOKEN;
  if (ORIGIN) transport.origin = ORIGIN;
}

const runtime = new MakiNukiRuntime({ registryUrl: REGISTRY, transport, validate: VALIDATE });

async function timed(label, fn) {
  const t0 = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - t0);
  return { result, ms };
}

async function main() {
  const { result: index, ms } = await timed("registry", () => runtime.registryIndex());
  const entry = index.sources.find((s) => s.id === SOURCE_ID);
  check(!!entry, `registry entry for ${SOURCE_ID} (${ms} ms)`, `sources=${index.sources.length}`);
  if (!entry) process.exit(1);
  pass(`registry ${REGISTRY} abiVersion=${entry.abiVersion} sha256=${entry.sha256.slice(0, 12)}...`);

  const source = await runtime.loadSource(SOURCE_ID);
  pass("wasm load + sha256 verified");

  const meta = await source.getMetadata();
  check(meta.abiVersion === 1, `get_metadata abiVersion=${meta.abiVersion}`, JSON.stringify(meta));
  pass(`get_metadata ${meta.id} v${meta.version}`);
  console.log(`       name=${meta.name} lang=${meta.lang} baseUrl=${meta.baseUrl}`);

  const filters = await source.getFilters();
  pass(`get_filters ${filters.length} (${filters.filter((f) => f.type === "checkbox").length} checkbox, ${filters.filter((f) => f.type === "select").length} select, ${filters.filter((f) => f.type === "tri_state").length} tri_state, ${filters.filter((f) => f.type === "text").length} text)`);

  const search = await timed("search", () => source.search({ query: QUERY, page: PAGE }));
  const searchRes = search.result;
  check(
    searchRes.page === PAGE && Array.isArray(searchRes.items) && typeof searchRes.hasNextPage === "boolean",
    `search "${QUERY}" page=${PAGE} mode=${source.lastTransportMode ?? "?"} (${search.ms} ms)`,
    JSON.stringify(searchRes).slice(0, 200),
  );
  pass(`       items=${searchRes.items.length} hasNextPage=${searchRes.hasNextPage}`);
  for (const item of searchRes.items.slice(0, 3)) {
    console.log(`       - ${item.title} (${item.id})`);
  }

  const detailsId = DETAILS_ID ?? searchRes.items[0]?.id;
  let details;
  if (!detailsId) {
    fail("get_details", "no items to derive an id from");
  } else {
    details = await timed("details", () => source.getDetails(detailsId));
    const detailsRes = details.result;
    check(
      detailsRes.id === detailsId && detailsRes.title && detailsRes.status && Array.isArray(detailsRes.chapters),
      `get_details ${detailsId.slice(0, 12)}... mode=${source.lastTransportMode ?? "?"} (${details.ms} ms)`,
      JSON.stringify(detailsRes).slice(0, 200),
    );
    pass(`       chapters=${detailsRes.chapters.length} status=${detailsRes.status} title=${detailsRes.title}`);
  }

  const pagesId = PAGES_ID ?? (LATEST ? details?.result?.chapters?.at(-1)?.id : details?.result?.chapters?.[0]?.id);
  if (!pagesId) {
    fail("get_pages", "no chapter id available");
  } else {
    const pages = await timed("pages", () => source.getPages(pagesId));
    const pagesRes = pages.result;
    const scrambled = pagesRes.filter((p) => p.isScrambled).length;
    check(
      pagesRes.length > 0 && pagesRes.every((p) => typeof p.index === "number" && p.url),
      `get_pages ${pagesId.slice(0, 12)}... mode=${source.lastTransportMode ?? "?"} (${pages.ms} ms)`,
      JSON.stringify(pagesRes).slice(0, 200),
    );
    pass(`       pages=${pagesRes.length} scrambled=${scrambled}`);
    for (const pageItem of pagesRes.slice(0, 2)) {
      console.log(`       - [${pageItem.index}] ${pageItem.url.slice(0, 90)}`);
    }

    if (FETCH_IMAGE_INDEX !== undefined) {
      const imageIndex = Number(FETCH_IMAGE_INDEX);
      let imageOk = false;
      for (let attempt = 0; attempt < 3 && !imageOk; attempt++) {
        const candidate = pagesRes[imageIndex + attempt];
        if (!candidate) break;
        try {
          const img = await timed("fetchImage", () => source.fetchImage(candidate));
          if (img.result.size > 0 && img.result.type.startsWith("image/")) {
            check(
              true,
              `fetchImage [${candidate.index}] ${img.result.type} ${img.result.size} bytes (${img.ms} ms)`,
              "",
            );
            imageOk = true;
          } else {
            console.log(`       - page [${candidate.index}] yielded ${img.result.type} ${img.result.size} bytes, trying next`);
          }
        } catch (err) {
          console.log(`       - page [${candidate.index}] fetch failed (${err.message}), trying next`);
        }
      }
      check(imageOk, "fetchImage at least one page", "all attempts empty (rotated CDN urls?)");
    }
  }

  await source.close();
  await runtime.close();

  if (failures > 0) {
    console.error(`RESULT: FAIL (${failures} failed)`);
    process.exit(1);
  }
  console.log("RESULT: PASS");
}

main().catch((err) => {
  console.error("RESULT: FAIL (exception)");
  console.error(err.stack ?? err.message ?? String(err));
  process.exit(1);
});
