import type { RegistryEntry, RegistryIndex } from "./types";

export type { RegistryEntry, RegistryIndex } from "./types";

export const ABI_VERSION = 1;
export const DEFAULT_REGISTRY_URL = "https://makinuki.github.io/index.json";

export class RegistryError extends Error {}

export class Registry {
  private cached: RegistryIndex | null = null;

  constructor(readonly registryUrl: string = DEFAULT_REGISTRY_URL) {}

  async index(): Promise<RegistryIndex> {
    if (this.cached) return this.cached;
    const res = await fetch(this.registryUrl);
    if (!res.ok) {
      throw new RegistryError(`registry fetch failed: HTTP ${res.status}`);
    }
    const index = (await res.json()) as RegistryIndex;
    if (index.version !== 1 || !Array.isArray(index.sources)) {
      throw new RegistryError("registry manifest has an unsupported format");
    }
    this.cached = index;
    return index;
  }

  async find(id: string): Promise<RegistryEntry> {
    const index = await this.index();
    const entry = index.sources.find((source) => source.id === id);
    if (!entry) throw new RegistryError(`source not found in registry: ${id}`);
    return entry;
  }

  static async sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  static async fetchVerifiedWasm(entry: RegistryEntry): Promise<Uint8Array> {
    if (entry.abiVersion !== ABI_VERSION) {
      throw new RegistryError(
        `source abiVersion ${entry.abiVersion} does not match runtime ABI ${ABI_VERSION}`,
      );
    }
    const res = await fetch(entry.wasmUrl);
    if (!res.ok) {
      throw new RegistryError(`wasm fetch failed: HTTP ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const digest = await Registry.sha256(bytes);
    if (digest !== entry.sha256) {
      throw new RegistryError(
        `wasm sha256 mismatch: expected ${entry.sha256}, got ${digest}`,
      );
    }
    return bytes;
  }
}