import { z } from "zod";

export const GoogleTokenBundleSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expiry: z.string(), // ISO 8601
});

export type GoogleTokenBundle = z.infer<typeof GoogleTokenBundleSchema>;
