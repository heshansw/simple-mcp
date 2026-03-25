import { z } from "zod";

export const RepoWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  folderIds: z.array(z.string().min(1)).min(2).max(20),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type RepoWorkspace = z.infer<typeof RepoWorkspaceSchema>;

export const CreateRepoWorkspaceSchema = RepoWorkspaceSchema.pick({
  name: true,
  description: true,
  folderIds: true,
});

export type CreateRepoWorkspaceInput = z.infer<typeof CreateRepoWorkspaceSchema>;
