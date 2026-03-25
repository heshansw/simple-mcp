import { z } from "zod";

export const ConfluencePageSchema = z.object({
  pageId: z.string().min(1),
  title: z.string(),
  spaceKey: z.string(),
  spaceName: z.string(),
  url: z.string().url(),
  version: z.number().int().positive(),
  lastModified: z.string().datetime(),
  author: z.object({ displayName: z.string(), accountId: z.string() }),
  contentMarkdown: z.string(),
  ancestors: z.array(z.object({ id: z.string(), title: z.string() })),
});

export const ConfluenceSpaceSchema = z.object({
  spaceKey: z.string().min(1),
  name: z.string(),
  type: z.enum(["global", "personal"]),
  url: z.string().url(),
  description: z.string().nullable(),
});

export const ConfluenceSearchResultSchema = z.object({
  pageId: z.string().min(1),
  title: z.string(),
  spaceKey: z.string(),
  spaceName: z.string(),
  url: z.string().url(),
  lastModified: z.string().datetime(),
  excerpt: z.string(),
});

export const AllowedSpaceKeysSchema = z
  .array(z.string().min(1).max(255).toUpperCase())
  .max(50);

export type ConfluencePage = z.infer<typeof ConfluencePageSchema>;
export type ConfluenceSpace = z.infer<typeof ConfluenceSpaceSchema>;
export type ConfluenceSearchResult = z.infer<typeof ConfluenceSearchResultSchema>;
export type AllowedSpaceKeys = z.infer<typeof AllowedSpaceKeysSchema>;
