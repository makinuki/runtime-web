import { afterEach, describe, expect, it, vi } from "vitest";
import { Registry, RegistryError } from "../src/registry";
import { unwrapEnvelope, PluginError } from "../src/plugin";
import { MemoryStorage, assertWithinCap } from "../src/storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Registry", () => {
  it("fetches and caches the manifest", async () => {
    const index = {
      version: 1,
      updatedAt: 1,
      sources: [
        {
          id: "mangadex",
          name: "MangaDex",
          version: "1.0.0",
          abiVersion: 1,
          lang: "multi",
          baseUrl: "https://mangadex.org",
          iconUrl: "https://mangadex.org/favicon.ico",
          nsfw: false,
          wasmUrl: "https://registry.example/mangadex.wasm",
          sha256: "a".repeat(64),
          minRuntimeVersion: "1.0.0",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(index)));
    vi.stubGlobal("fetch", fetchMock);

    const registry = new Registry("https://registry.example/index.json");
    const first = await registry.index();
    await registry.index();
    const entry = await registry.find("mangadex");

    expect(first.sources).toHaveLength(1);
    expect(entry.id).toBe("mangadex");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown source id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{\"version\":1,\"updatedAt\":1,\"sources\":[]}")));
    await expect(new Registry().find("nope")).rejects.toThrow(RegistryError);
  });

  it("verifies sha256 of fetched wasm and gates abiVersion", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const digest = await Registry.sha256(bytes);
    const entry = {
      id: "x",
      name: "X",
      version: "1.0.0",
      abiVersion: 1,
      lang: "en",
      baseUrl: "https://x.example",
      iconUrl: "https://x.example/i.png",
      nsfw: false,
      wasmUrl: "https://registry.example/x.wasm",
      sha256: digest,
      minRuntimeVersion: "1.0.0",
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Response(bytes)));

    const ok = await Registry.fetchVerifiedWasm(entry);
    expect(ok).toEqual(bytes);

    await expect(
      Registry.fetchVerifiedWasm({ ...entry, sha256: "f".repeat(64) }),
    ).rejects.toThrow(/sha256 mismatch/);

    await expect(
      Registry.fetchVerifiedWasm({ ...entry, abiVersion: 2 }),
    ).rejects.toThrow(/abiVersion 2 does not match/);
  });
});

describe("unwrapEnvelope", () => {
  it("unwraps success envelopes", () => {
    expect(unwrapEnvelope<{ a: number }>('{"ok":true,"data":{"a":1}}')).toEqual({ a: 1 });
  });

  it("throws PluginError with code on failure envelopes", () => {
    try {
      unwrapEnvelope('{"ok":false,"error":{"code":"CLOUDFLARE_BLOCKED","message":"challenge"}}');
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginError);
      expect((err as PluginError).code).toBe("CLOUDFLARE_BLOCKED");
    }
  });

  it("rejects malformed JSON", () => {
    expect(() => unwrapEnvelope("not json")).toThrow(PluginError);
    expect(() => unwrapEnvelope("null")).toThrow(/non-object/);
  });
});

describe("storage caps", () => {
  it("enforces the 64 KB value cap", () => {
    assertWithinCap("x".repeat(64 * 1024));
    expect(() => assertWithinCap("x".repeat(64 * 1024 + 1))).toThrow(/64 KB/);
  });

  it("MemoryStorage distinguishes missing keys from empty values", async () => {
    const storage = new MemoryStorage();
    expect(await storage.get("missing")).toBeNull();
    await storage.set("empty", "");
    expect(await storage.get("empty")).toBe("");
  });
});