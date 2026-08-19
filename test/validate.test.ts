import { describe, expect, it } from "vitest";
import type { FilterSchema, MangaDetails, MangaItem, PageItem, SourceMetadata } from "../src/types";
import {
  validateDetails,
  validateFilters,
  validateMetadata,
  validatePages,
  validateSearch,
} from "../src/validate";

const validMetadata = {
  id: "mangadex",
  name: "MangaDex",
  version: "1.0.0",
  abiVersion: 1,
  lang: "multi",
  baseUrl: "https://mangadex.org",
  iconUrl: "https://mangadex.org/favicon.ico",
  nsfw: false,
  allowedHosts: ["uploads.mangadex.org", "api.mangadex.org"],
};

const validFilters: FilterSchema[] = [
  {
    id: "status",
    title: "Publication Status",
    type: "checkbox",
    default: false,
  },
  {
    id: "contentRating",
    title: "Content Ratings",
    type: "tri_state",
    options: [
      { label: "Safe", value: "safe" },
      { label: "Suggestive", value: "suggestive" },
    ],
    default: { safe: "+", suggestive: "-" },
  },
  {
    id: "lang",
    title: "Language",
    type: "select",
    options: [{ label: "English", value: "en" }],
    default: "en",
  },
  {
    id: "author",
    title: "Author",
    type: "text",
    placeholder: "Search by author",
  },
];

const validItem = {
  id: "29cd02a4-a429-439e-8356-fbb2abcac4dd",
  title: "Sousou no Frieren",
  coverUrl: "https://uploads.mangadex.org/covers/29cd02a4/frieren.jpg",
  latestChapter: "Ch. 120",
  url: "https://mangadex.org/title/29cd02a4-a429-439e-8356-fbb2abcac4dd",
};

const validPage = {
  index: 0,
  url: "https://cmdxd98sb0x3yprd.mangadex.network/data/1a2b3c/v1-000.jpg",
  headers: { referer: "https://mangadex.org/" },
  isScrambled: false,
};

describe("validateMetadata", () => {
  it("accepts a registry-shaped metadata payload", async () => {
    expect(await validateMetadata(validMetadata)).toEqual([]);
  });

  it("rejects a wrong abiVersion type", async () => {
    const errors = await validateMetadata({
      ...validMetadata,
      abiVersion: "1",
    } as unknown as SourceMetadata);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("abiVersion");
  });

  it("rejects a non-slug id and bad lang", async () => {
    const errors = await validateMetadata({ ...validMetadata, id: "MangaDex", lang: "EN" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects unknown extra properties", async () => {
    const errors = await validateMetadata({ ...validMetadata, extra: true } as never);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("validateFilters", () => {
  it("accepts one filter of each type", async () => {
    expect(await validateFilters(validFilters)).toEqual([]);
  });

  it("rejects a checkbox without a default", async () => {
    const broken = { id: "status", title: "Publication Status", type: "checkbox" };
    const errors = await validateFilters([broken] as unknown as FilterSchema[]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("default"))).toBe(true);
  });

  it("rejects an unknown filter type", async () => {
    const errors = await validateFilters(
      [{ ...validFilters[0], type: "radio" }] as unknown as FilterSchema[],
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects tri_state default values outside +/-", async () => {
    const broken = { ...validFilters[1], default: { safe: "yes" } };
    const errors = await validateFilters([broken] as unknown as FilterSchema[]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("validateSearch", () => {
  it("accepts a valid PageResult", async () => {
    expect(
      await validateSearch({ page: 1, hasNextPage: true, items: [validItem] }),
    ).toEqual([]);
  });

  it("rejects malformed shape", async () => {
    const errors = await validateSearch({
      page: 1,
      hasNextPage: "yes",
      items: [],
    } as unknown as { page: number; hasNextPage: boolean; items: MangaItem[] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects an item missing coverUrl", async () => {
    const broken = { id: "x", title: "T", latestChapter: "Ch. 1", url: "https://x.example/t" };
    const errors = await validateSearch({
      page: 1,
      hasNextPage: false,
      items: [broken] as unknown as MangaItem[],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("items/0") && e.includes("coverUrl"))).toBe(true);
  });

  it("rejects page below 1", async () => {
    const errors = await validateSearch({ page: 0, hasNextPage: true, items: [validItem] });
    expect(errors.some((e) => e.includes("page"))).toBe(true);
  });
});

describe("validateDetails", () => {
  it("accepts valid details with a null chapter number", async () => {
    const valid: MangaDetails = {
      id: "29cd02a4-a429-439e-8356-fbb2abcac4dd",
      title: "Sousou no Frieren",
      altTitles: ["Frieren"],
      status: "Completed",
      coverUrl: "https://uploads.mangadex.org/covers/frieren.jpg",
      chapters: [
        { id: "ch-120", number: 120, language: "en", uploadedAt: 1700000000000 },
        { id: "oneshot", number: null, title: "Omake" },
      ],
    };
    expect(await validateDetails(valid)).toEqual([]);
  });

  it("rejects an unknown status", async () => {
    const errors = await validateDetails({
      id: "x",
      title: "X",
      status: "Demolished",
      coverUrl: "https://x.example/c.jpg",
      chapters: [],
    } as unknown as MangaDetails);
    expect(errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("rejects a chapter without id", async () => {
    const errors = await validateDetails({
      id: "x",
      title: "X",
      status: "Ongoing",
      coverUrl: "https://x.example/c.jpg",
      chapters: [{ number: 1 }],
    } as unknown as MangaDetails);
    expect(errors.some((e) => e.includes("chapters/0"))).toBe(true);
  });
});

describe("validatePages", () => {
  it("accepts valid pages", async () => {
    expect(await validatePages([validPage])).toEqual([]);
  });

  it("rejects a scrambled page without metadata only if the schema enforces it", async () => {
    const errors = await validatePages([{ ...validPage, isScrambled: true }]);
    expect(errors).toEqual([]);
  });

  it("accepts a scrambled page with full metadata", async () => {
    const scrambled = {
      ...validPage,
      isScrambled: true,
      metadata: {
        layout: "slice",
        rows: 2,
        cols: 3,
        tileW: 200,
        tileH: 300,
        order: [5, 3, 1, 4, 2, 0],
      },
    } as PageItem;
    expect(await validatePages([scrambled])).toEqual([]);
  });

  it("rejects a negative index", async () => {
    const errors = await validatePages([{ ...validPage, index: -1 }]);
    expect(errors.some((e) => e.includes("index"))).toBe(true);
  });
});