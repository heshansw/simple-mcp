import type { ZodError } from "zod";

export type ToolLogger = {
  info(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
};

export function createValidationErrorResponse(error: ZodError): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: `Validation error: ${error.issues.map((issue) => issue.message).join("; ")}`,
      },
    ],
    isError: true,
  };
}
