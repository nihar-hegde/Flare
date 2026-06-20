import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "../lib/ai/provider.js";
import { env } from "../lib/env.js";

const FIX_TIME_BUDGET_MS = 60_000;

const codeFixSchema = z.object({
  summary: z
    .string()
    .describe("One or two sentences describing the change you made and why."),
  confident: z
    .boolean()
    .describe(
      "True only if you applied a correct, minimal fix that removes the incident mechanism. False if the given context is insufficient.",
    ),
  changes: z
    .array(
      z.object({
        path: z
          .string()
          .describe("Repo-relative path of a file you edited. Must be one of the provided files."),
        newContent: z
          .string()
          .describe(
            "The COMPLETE updated contents of the file, with the fix applied and all unrelated code preserved exactly.",
          ),
      }),
    )
    .describe("Only the files that changed. Empty when confident is false."),
});

export type CodeFixResult = z.infer<typeof codeFixSchema>;

export interface CodeFixInput {
  rootCause: string | null;
  mechanism: string | null;
  failurePoint: string | null;
  fixDetail: string | null;
  files: { path: string; content: string }[];
}

const SYSTEM_PROMPT = `You are a senior engineer applying the smallest correct fix for a production incident.

Rules:
- Make the minimal change that removes the incident mechanism while preserving all intended behavior.
- Return the COMPLETE updated contents for each file you change — never a diff, never a fragment.
- Preserve all unrelated code, imports, formatting, and style exactly as-is.
- Only edit the files provided to you. Never invent new file paths.
- Do not add comments that narrate the incident or mention Flare.
- If the provided context is not enough to make a correct, safe fix, set confident=false and return no changes.`;

function buildPrompt(input: CodeFixInput): string {
  const context = [
    input.rootCause ? `Root cause: ${input.rootCause}` : null,
    input.mechanism ? `Mechanism: ${input.mechanism}` : null,
    input.failurePoint ? `Failure point: ${input.failurePoint}` : null,
    input.fixDetail ? `Intended fix: ${input.fixDetail}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const fileBlocks = input.files
    .map(
      (file) =>
        `File: ${file.path}\n\`\`\`\`\n${file.content}\n\`\`\`\``,
    )
    .join("\n\n");

  return [
    "Apply the smallest correct fix for this incident.",
    "",
    context,
    "",
    "Current file contents:",
    "",
    fileBlocks,
  ].join("\n");
}

/**
 * Ask the model to produce the actual code fix as complete file replacements.
 * The caller is responsible for whitelisting paths and discarding no-op edits.
 */
export async function generateCodeFix(input: CodeFixInput): Promise<CodeFixResult> {
  const model = resolveModel(env.INVESTIGATOR_MODEL);
  const { object } = await generateObject({
    model,
    schema: codeFixSchema,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    abortSignal: AbortSignal.timeout(FIX_TIME_BUDGET_MS),
  });
  return object;
}
