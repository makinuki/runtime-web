export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const STORAGE_VALUE_CAP = 64 * 1024;

export class MemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  private readonly backend: Storage;

  constructor(backend: Storage | null = globalThis.localStorage ?? null) {
    if (!backend) throw new Error("localStorage is not available");
    this.backend = backend;
  }

  async get(key: string): Promise<string | null> {
    return this.backend.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.backend.setItem(key, value);
  }
}

export function assertWithinCap(value: string): void {
  if (new TextEncoder().encode(value).byteLength > STORAGE_VALUE_CAP) {
    throw new Error("storage value exceeds 64 KB cap");
  }
}