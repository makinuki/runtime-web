import { ABI_VERSION, Registry, type RegistryEntry, type RegistryIndex } from "./registry";
import { TransportManager, type TransportMode, type TransportOptions } from "./transport";
import { makeHostFunctions, namespacedStorageKey } from "./host-functions";
import { MakiNukiPlugin } from "./plugin";
import { findSetting, isSensitiveSetting, serializeSettingValue } from "./settings";
import { LocalStorageAdapter, MemoryStorage, type StorageAdapter } from "./storage";
import { unscramblePageBlob } from "./unscramble";
import {
  validateDetails,
  validateFilters,
  validateMetadata,
  validatePages,
  validateSearch,
  validateSettings,
} from "./validate";
import type {
  FilterSchema,
  MangaDetails,
  MangaItem,
  PageItem,
  PageResult,
  SearchQuery,
  SettingSchema,
  SourceMetadata,
} from "./types";

export interface MakiNukiRuntimeOptions {
  registryUrl?: string;
  proxyUrl?: string;
  clientToken?: string;
  storage?: StorageAdapter;
  validate?: boolean;
  transport?: TransportOptions;
}

function assertJspiAvailable(): void {
  if (typeof WebAssembly === "undefined" || !("Suspending" in WebAssembly)) {
    throw new Error(
      "This browser does not expose WebAssembly JSPI (WebAssembly.Suspending). " +
        "Use Chromium 123+ / Edge 123+ / Chrome for Android.",
    );
  }
}

function defaultStorage(): StorageAdapter {
  try {
    return new LocalStorageAdapter();
  } catch {
    return new MemoryStorage();
  }
}

function entryFromMetadata(meta: SourceMetadata, wasmUrl: string): RegistryEntry {
  return {
    id: meta.id,
    name: meta.name,
    version: meta.version,
    abiVersion: meta.abiVersion,
    lang: meta.lang,
    baseUrl: meta.baseUrl,
    iconUrl: meta.iconUrl,
    nsfw: meta.nsfw,
    wasmUrl,
    sha256: "",
    minRuntimeVersion: "1.0.0",
    allowedHosts: meta.allowedHosts,
    rateLimit: meta.rateLimit,
    retry: meta.retry,
  };
}

export class MakiNukiSource {
  readonly id: string;
  readonly metadata: SourceMetadata;
  // Probed at load from the plugin's optional get_settings export.
  readonly hasSettings: boolean;
  private readonly plugin: MakiNukiPlugin;
  private readonly transport: TransportManager;
  private readonly storage: StorageAdapter;
  private readonly validate: boolean;

  constructor(
    entry: RegistryEntry,
    plugin: MakiNukiPlugin,
    transport: TransportManager,
    storage: StorageAdapter,
    validate: boolean,
    hasSettings: boolean,
  ) {
    this.id = entry.id;
    this.metadata = {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      abiVersion: entry.abiVersion,
      lang: entry.lang,
      baseUrl: entry.baseUrl,
      iconUrl: entry.iconUrl,
      nsfw: entry.nsfw,
      allowedHosts: entry.allowedHosts,
      rateLimit: entry.rateLimit,
      retry: entry.retry,
    };
    this.plugin = plugin;
    this.transport = transport;
    this.storage = storage;
    this.validate = validate;
    this.hasSettings = hasSettings;
  }

  get lastTransportMode(): TransportMode | null {
    return this.transport.lastMode;
  }

  private async validated<T>(
    name: string,
    check: (payload: T) => Promise<string[]>,
    payload: T,
  ): Promise<T> {
    if (this.validate) {
      const errors = await check(payload);
      for (const error of errors) console.warn(`[makinuki] ${error}`);
    }
    return payload;
  }

  async getMetadata(): Promise<SourceMetadata> {
    const payload = await this.plugin.callStatic<SourceMetadata>("get_metadata");
    return this.validated("get_metadata", validateMetadata, payload);
  }

  async getFilters(): Promise<FilterSchema[]> {
    const payload = await this.plugin.callStatic<FilterSchema[]>("get_filters");
    return this.validated("get_filters", validateFilters, payload);
  }

  // Declared settings in the order the source lists them; an empty array when
  // the plugin carries no get_settings export.
  async getSettings(): Promise<SettingSchema[]> {
    if (!this.hasSettings) return [];
    const payload = await this.plugin.callStatic<SettingSchema[]>("get_settings");
    return this.validated("get_settings", validateSettings, payload);
  }

  async search(query?: Partial<SearchQuery>): Promise<PageResult<MangaItem>> {
    const input: SearchQuery = {
      query: query?.query ?? "",
      page: query?.page ?? 1,
      filters: query?.filters ?? {},
    };
    const payload = await this.plugin.callDynamic<PageResult<MangaItem>>(
      "search",
      JSON.stringify(input),
    );
    return this.validated("search", validateSearch, payload);
  }

  async getDetails(mangaId: string): Promise<MangaDetails> {
    const payload = await this.plugin.callDynamic<MangaDetails>(
      "get_details",
      JSON.stringify(mangaId),
    );
    return this.validated("get_details", validateDetails, payload);
  }

  async getPages(chapterId: string): Promise<PageItem[]> {
    const payload = await this.plugin.callDynamic<PageItem[]>(
      "get_pages",
      JSON.stringify(chapterId),
    );
    return this.validated("get_pages", validatePages, payload);
  }

  async fetchImage(page: PageItem): Promise<Blob> {
    return this.transport.fetchImage(page.url, page.headers);
  }

  async unscrambleImage(bytes: Uint8Array): Promise<Uint8Array> {
    return this.plugin.unscramble(bytes);
  }

  async fetchScrambledPage(page: PageItem): Promise<Blob> {
    return unscramblePageBlob(this.plugin, this.transport, page);
  }

  // Settings persistence. Values land in the plugin's per-source storage
  // namespace, so the plugin reads them back through
  // makinuki_storage_get at call time; null resets a setting by deleting the
  // key, which makes the declared default apply again.
  async setSetting(id: string, value: string | boolean | null): Promise<void> {
    const setting = await this.declaredSetting(id);
    const key = namespacedStorageKey(this.id, id);
    if (value === null) {
      await this.storage.delete(key);
      return;
    }
    await this.storage.set(key, serializeSettingValue(setting, value));
  }

  async isSettingSet(id: string): Promise<boolean> {
    await this.declaredSetting(id);
    return (await this.storage.get(namespacedStorageKey(this.id, id))) !== null;
  }

  // Sensitive values are never returned; isSettingSet() reports those.
  async getSettingValue(id: string): Promise<string | null> {
    const setting = await this.declaredSetting(id);
    if (isSensitiveSetting(setting)) {
      throw new Error(`setting ${id} is sensitive; use isSettingSet()`);
    }
    return this.storage.get(namespacedStorageKey(this.id, id));
  }

  private async declaredSetting(id: string): Promise<SettingSchema> {
    return findSetting(await this.getSettings(), id);
  }

  async close(): Promise<void> {
    await this.plugin.close();
  }
}

export class MakiNukiRuntime {
  readonly registry: Registry;
  readonly transport: TransportManager;
  readonly validate: boolean;
  private readonly storage: StorageAdapter;
  private readonly sources = new Set<MakiNukiSource>();

  constructor(options: MakiNukiRuntimeOptions = {}) {
    assertJspiAvailable();
    this.registry = new Registry(options.registryUrl);
    this.transport = new TransportManager(options.transport);
    this.validate = options.validate ?? false;
    this.storage = options.storage ?? defaultStorage();
  }

  async registryIndex(): Promise<RegistryIndex> {
    return this.registry.index();
  }

  async transportMode(): Promise<TransportMode | null> {
    return this.transport.detect();
  }

  async loadSource(wasmUrlOrId: string): Promise<MakiNukiSource> {
    let entry: RegistryEntry | null = null;
    let wasmBytes: Uint8Array;
    if (wasmUrlOrId.startsWith("http://") || wasmUrlOrId.startsWith("https://")) {
      const res = await fetch(wasmUrlOrId);
      if (!res.ok) throw new Error(`wasm fetch failed: HTTP ${res.status}`);
      wasmBytes = new Uint8Array(await res.arrayBuffer());
    } else {
      entry = await this.registry.find(wasmUrlOrId);
      wasmBytes = await Registry.fetchVerifiedWasm(entry);
    }
    const source = await this.spawnSource(entry, wasmBytes, wasmUrlOrId);
    this.sources.add(source);
    return source;
  }

  private async spawnSource(
    entry: RegistryEntry | null,
    wasmBytes: Uint8Array,
    wasmUrl: string,
  ): Promise<MakiNukiSource> {
    const functions = makeHostFunctions({
      transport: this.transport,
      storage: this.storage,
      sourceId: entry?.id ?? "unknown",
    });
    const plugin = await MakiNukiPlugin.load(wasmBytes, functions);
    const hasSettings = await plugin.hasExport("get_settings");
    if (!entry) {
      const meta = await plugin.callStatic<SourceMetadata>("get_metadata");
      if (meta.abiVersion !== ABI_VERSION) {
        await plugin.close();
        throw new Error(
          `source abiVersion ${meta.abiVersion} does not match runtime ABI ${ABI_VERSION}`,
        );
      }
      entry = entryFromMetadata(meta, wasmUrl);
    }
    return new MakiNukiSource(
      entry,
      plugin,
      this.transport,
      this.storage,
      this.validate,
      hasSettings,
    );
  }

  async close(): Promise<void> {
    for (const source of this.sources) {
      await source.close();
    }
    this.sources.clear();
  }
}

export type {
  ChapterItem,
  CheckboxFilter,
  CheckboxSetting,
  CoverVariant,
  ErrorCode,
  FilterSchema,
  HttpRequest,
  HttpResponse,
  MangaDetails,
  MangaItem,
  PageItem,
  PageResult,
  PluginResult,
  RateLimitHint,
  RegistryEntry,
  RegistryIndex,
  RetryHint,
  ScrambleInfo,
  SearchQuery,
  SelectFilter,
  SelectSetting,
  SettingSchema,
  SourceMetadata,
  TextFilter,
  TextSetting,
  TriStateFilter,
} from "./types";
