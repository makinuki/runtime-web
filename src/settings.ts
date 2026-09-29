import { assertWithinCap } from "./storage";
import type { SettingSchema } from "./types";

export function findSetting(settings: SettingSchema[], id: string): SettingSchema {
  const setting = settings.find((entry) => entry.id === id);
  if (!setting) throw new Error(`unknown setting id: ${id}`);
  return setting;
}

export function isSensitiveSetting(setting: SettingSchema): boolean {
  return setting.type === "text" && setting.sensitive === true;
}

// Serializes a value for storage, enforcing the declared setting: the value
// kind must match the declared type, select values must be one of the declared
// options, and every value is subject to the 64 KB storage cap.
export function serializeSettingValue(setting: SettingSchema, value: string | boolean): string {
  if (setting.type === "checkbox") {
    if (typeof value !== "boolean") throw new Error(`setting ${setting.id} expects a boolean`);
    return value ? "true" : "false";
  }
  if (typeof value !== "string") throw new Error(`setting ${setting.id} expects a string`);
  if (setting.type === "select" && !setting.options.some((option) => option.value === value)) {
    throw new Error(
      `setting ${setting.id} expects one of: ${setting.options.map((option) => option.value).join(", ")}`,
    );
  }
  assertWithinCap(value);
  return value;
}
