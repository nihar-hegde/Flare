import type { AgentStep } from "@repo/db";
import {
  generateObject,
  generateText,
  Output,
  stepCountIs,
  type StepResult,
} from "ai";
import { env } from "../env.js";
import type { InvestigationContext } from "./context.js";
import { buildFallbackPrompt, buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { resolveModel } from "./provider.js";
import { investigationReportSchema, type InvestigationReport } from "./schema.js";
import { buildInvestigationTools, type InvestigationTools } from "./tools.js";

/** Hard cap on agent reasoning/tool steps so a run can't loop forever. */
const MAX_STEPS = 8;
/** Wall-clock budget for a single model run; aborts and falls back if exceeded. */
const TIME_BUDGET_MS = 60_000;

export interface InvestigationResult {
  report: InvestigationReport;
  steps: AgentStep[];
  model: string;
  tokens: number | null;
  usedFallback: boolean;
}

/**
 * Run the investigation. Primary path is an agentic tool-calling loop that
 * gathers evidence and emits a structured report. If that fails or times out
 * (e.g. tool/output incompatibility, network), we fall back to a single
 * structured call with all evidence inlined — so a run always returns a report.
 */
export async function investigate(
  ctx: InvestigationContext,
): Promise<InvestigationResult> {
  const model = resolveModel(env.INVESTIGATOR_MODEL);
  const tools = buildInvestigationTools(ctx);

  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(ctx),
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      experimental_output: Output.object({ schema: investigationReportSchema }),
      abortSignal: AbortSignal.timeout(TIME_BUDGET_MS),
    });

    return {
      report: result.experimental_output,
      steps: toAgentSteps(result.steps),
      model: env.INVESTIGATOR_MODEL,
      tokens: result.totalUsage.totalTokens ?? null,
      usedFallback: false,
    };
  } catch (err) {
    console.warn(
      "[investigator] agentic run failed; using single-shot fallback:",
      err instanceof Error ? err.message : err,
    );

    const result = await generateObject({
      model,
      schema: investigationReportSchema,
      system: SYSTEM_PROMPT,
      prompt: buildFallbackPrompt(ctx),
      abortSignal: AbortSignal.timeout(TIME_BUDGET_MS),
    });

    return {
      report: result.object,
      steps: [
        {
          index: 0,
          tool: "single_shot_fallback",
          reasoning:
            "The agentic tool loop was unavailable, so the incident context was analyzed in a single pass.",
        },
      ],
      model: env.INVESTIGATOR_MODEL,
      tokens: result.usage.totalTokens ?? null,
      usedFallback: true,
    };
  }
}

/** Flatten the SDK's per-step tool calls/results into our persisted trace. */
function toAgentSteps(steps: StepResult<InvestigationTools>[]): AgentStep[] {
  const out: AgentStep[] = [];
  let index = 0;

  for (const step of steps) {
    const resultByCallId = new Map(
      step.toolResults.map((r) => [r.toolCallId, r]),
    );
    for (const call of step.toolCalls) {
      const match = resultByCallId.get(call.toolCallId);
      out.push({
        index: index++,
        tool: call.toolName,
        input: call.input,
        output: match?.output,
        reasoning: step.text.trim() || undefined,
      });
    }
  }

  return out;
}
