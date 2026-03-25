import { z } from "zod";

export const FolderAccessStatusSchema = z.enum([
  "active",
  "path_not_found",
  "disabled",
]);

export type FolderAccessStatus = z.infer<typeof FolderAccessStatusSchema>;

export const FolderAccessConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  absolutePath: z.string().min(1),
  allowedExtensions: z.array(z.string().startsWith(".")).default([]),
  maxFileSizeKb: z.number().int().min(1).max(10240).default(512),
  recursive: z.boolean().default(true),
  status: FolderAccessStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type FolderAccessConfig = z.infer<typeof FolderAccessConfigSchema>;

export const CreateFolderAccessSchema = FolderAccessConfigSchema.pick({
  name: true,
  absolutePath: true,
  allowedExtensions: true,
  maxFileSizeKb: true,
  recursive: true,
});

export type CreateFolderAccessInput = z.infer<typeof CreateFolderAccessSchema>;
