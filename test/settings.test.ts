import { describe, expect, it } from "vitest";
import { namespacedStorageKey } from "../src/host-functions";
import { findSetting, isSensitiveSetting, serializeSettingValue } from "../src/settings";
import { MemoryStorage } from "../src/storage";
import type { SettingSchema } from "../src/types";

const checkbox: SettingSchema = { id: "data_saver", title: "Data saver", type: "checkbox", default: false };
const select: SettingSchema = {
  id: "quality",
  title: "Quality",
  type: "select",
  options: [
    { label: "High", value: "high" },
    { label: "Low", value: "low" },
  ],
  default: "high",
};
const text: SettingSchema = {
  id: "base_url",
  title: "Site address",
  type: "text",
  default: "https://x.example",
};
const sensitive: SettingSchema = { id: "token", title: "Token", type: "text", sensitive: true };

describe("serializeSettingValue", () => {
  it("serializes checkbox values as true/false strings", () => {
    expect(serializeSettingValue(checkbox, true)).toBe("true");
    expect(serializeSettingValue(checkbox, false)).toBe("false");
  });

  it("rejects a non-boolean checkbox value", () => {
    expect(() => serializeSettingValue(checkbox, "true")).toThrow(/expects a boolean/);
  });

  it("accepts a declared select option and rejects undeclared ones", () => {
    expect(serializeSettingValue(select, "low")).toBe("low");
    expect(() => serializeSettingValue(select, "ultra")).toThrow(/expects one of/);
  });

  it("keeps text values raw, including the empty string, and enforces the cap", () => {
    expect(serializeSettingValue(text, "")).toBe("");
    expect(serializeSettingValue(text, "https://mirror.example")).toBe("https://mirror.example");
    expect(() => serializeSettingValue(text, "x".repeat(64 * 1024 + 1))).toThrow(/64 KB/);
  });
});

describe("findSetting", () => {
  it("returns the declared setting and rejects unknown ids", () => {
    expect(findSetting([checkbox, select], "quality")).toBe(select);
    expect(() => findSetting([checkbox], "nope")).toThrow(/unknown setting id/);
  });
});

describe("isSensitiveSetting", () => {
  it("flags only sensitive text settings", () => {
    expect(isSensitiveSetting(sensitive)).toBe(true);
    expect(isSensitiveSetting(text)).toBe(false);
    expect(isSensitiveSetting(checkbox)).toBe(false);
  });
});

describe("storage namespacing", () => {
  it("prefixes keys with the source id", () => {
    expect(namespacedStorageKey("mangadex", "data_saver")).toBe("mangadex:data_saver");
  });

  it("deletes values through the adapter", async () => {
    const storage = new MemoryStorage();
    await storage.set("mangadex:base_url", "https://mirror.example");
    expect(await storage.get("mangadex:base_url")).toBe("https://mirror.example");
    await storage.delete("mangadex:base_url");
    expect(await storage.get("mangadex:base_url")).toBeNull();
  });
});
