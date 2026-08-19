import type { CallContext } from "@extism/extism";
import { TransportManager } from "./transport";
import { assertWithinCap, type StorageAdapter } from "./storage";
import type { HttpRequest } from "./types";

export type HostFunction = (callContext: CallContext, input: bigint) => Promise<bigint>;

export interface HostFunctionContext {
  transport: TransportManager;
  storage: StorageAdapter;
  sourceId: string;
}

export function makeHostFunctions(context: HostFunctionContext): Record<string, HostFunction> {
  const storageKey = (key: string): string => `${context.sourceId}:${key}`;

  const makinukiFetch: HostFunction = async (callContext, input) => {
    const raw = callContext.read(input);
    if (raw === null) throw new Error("makinuki_fetch: missing input");
    const request = JSON.parse(raw.text()) as HttpRequest;
    const response = await context.transport.fetch(request);
    const payload = JSON.stringify(response);
    return callContext.store(payload);
  };

  const makinukiStorageGet: HostFunction = async (callContext, input) => {
    const raw = callContext.read(input);
    if (raw === null) throw new Error("makinuki_storage_get: missing input");
    const key = JSON.parse(raw.text()) as string;
    const value = await context.storage.get(storageKey(key));
    return value === null ? 0n : callContext.store(value);
  };

  const makinukiStorageSet: HostFunction = async (callContext, input) => {
    const raw = callContext.read(input);
    if (raw === null) throw new Error("makinuki_storage_set: missing input");
    const { key, value } = JSON.parse(raw.text()) as { key: string; value: string };
    assertWithinCap(value);
    await context.storage.set(storageKey(key), value);
    return 0n;
  };

  const makinukiLog: HostFunction = async (callContext, input) => {
    const raw = callContext.read(input);
    if (raw === null) throw new Error("makinuki_log: missing input");
    const { level, message } = JSON.parse(raw.text()) as { level?: string; message?: string };
    const text = `[makinuki:${context.sourceId}] ${message ?? ""}`;
    if (level === "error") console.error(text);
    else if (level === "warn") console.warn(text);
    else if (level === "debug") console.debug(text);
    else console.info(text);
    return 0n;
  };

  return {
    makinuki_fetch: makinukiFetch,
    makinuki_storage_get: makinukiStorageGet,
    makinuki_storage_set: makinukiStorageSet,
    makinuki_log: makinukiLog,
  };
}

export function hostNamespaces(
  functions: Record<string, HostFunction>,
): Record<string, Record<string, HostFunction>> {
  return {
    "extism:host/makinuki": functions,
    makinuki: functions,
  };
}