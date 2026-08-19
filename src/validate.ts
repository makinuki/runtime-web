import type Ajv from "ajv";
import type { ErrorObject } from "ajv";
import type { FilterSchema, MangaItem, MangaDetails, PageItem, SourceMetadata } from "./types";

import chapterSchema from "@makinuki/spec/schemas/chapter.schema.json" with { type: "json" };
import detailsSchema from "@makinuki/spec/schemas/details.schema.json" with { type: "json" };
import filterSchema from "@makinuki/spec/schemas/filter.schema.json" with { type: "json" };
import mangaSchema from "@makinuki/spec/schemas/manga.schema.json" with { type: "json" };
import metadataSchema from "@makinuki/spec/schemas/metadata.schema.json" with { type: "json" };
import pageSchema from "@makinuki/spec/schemas/page.schema.json" with { type: "json" };
import pagesSchema from "@makinuki/spec/schemas/pages.schema.json" with { type: "json" };

const SCHEMA_BASE = "https://makinuki.github.io/schemas";

let ajvPromise: Promise<Ajv> | null = null;

async function getAjv(): Promise<Ajv> {
  if (!ajvPromise) {
    ajvPromise = import("ajv").then(async ({ default: Ajv }) => {
      const { default: addFormats } = await import("ajv-formats");
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      ajv.addSchema(
        [
          metadataSchema,
          filterSchema,
          mangaSchema,
          detailsSchema,
          chapterSchema,
          pagesSchema,
          pageSchema,
        ] as object[],
      );
      return ajv;
    });
  }
  return ajvPromise;
}

function ref(name: string): object {
  return { $ref: `${SCHEMA_BASE}/${name}.schema.json` };
}

export async function validateMetadata(payload: SourceMetadata): Promise<string[]> {
  return validateAgainst("get_metadata", payload, ref("metadata"));
}

export async function validateFilters(payload: FilterSchema[]): Promise<string[]> {
  return validateAgainst("get_filters", payload, ref("filter"));
}

export async function validateDetails(payload: MangaDetails): Promise<string[]> {
  return validateAgainst("get_details", payload, ref("details"));
}

export async function validatePages(payload: PageItem[]): Promise<string[]> {
  return validateAgainst("get_pages", payload, ref("pages"));
}

export async function validateSearch(payload: {
  page: number;
  hasNextPage: boolean;
  items: MangaItem[];
}): Promise<string[]> {
  return validateAgainst("search", payload, ref("manga"));
}

async function validateAgainst(name: string, payload: unknown, schema: object): Promise<string[]> {
  const ajv = await getAjv();
  const validate = ajv.compile(schema);
  if (validate(payload)) return [];
  return (validate.errors ?? []).map(
    (error: ErrorObject) => `${name}${error.instancePath || "/"} ${error.message ?? "invalid"}`,
  );
}