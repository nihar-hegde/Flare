import { createOpenAI } from "@ai-sdk/openai";
import { createProviderRegistry, type LanguageModel } from "ai";
import { env } from "../env.js";

/**
 * Provider-agnostic model registry. Models are referenced as `<provider>:<model>`
 * (e.g. `openai:gpt-4o`) so the active model is chosen entirely by env var
 * (`INVESTIGATOR_MODEL`). Adding Anthropic/Google later is a one-line change here
 * plus the corresponding `@ai-sdk/*` dependency — no call-site edits.
 */
const registry = createProviderRegistry({
  openai: createOpenAI({ apiKey: env.OPENAI_API_KEY }),
});

type ModelSpec = Parameters<typeof registry.languageModel>[0];

/** Resolve a `<provider>:<model>` spec into a concrete language model. */
export function resolveModel(spec: string): LanguageModel {
  return registry.languageModel(spec as ModelSpec);
}
