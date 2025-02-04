import { generateText } from "ai";
import {
  geminiFlashModel,
  gemini2FlashModel,
  geminiProModel,
} from "../config/ai-config";
import { EXTRACT_EXPERIENCES, PROCESS_STIMULUS } from "../templates";
import { GENERATE_PLAN } from "../templates/generate-plan";
import { zodToJsonSchema } from "zod-to-json-schema";
import { llmLogger } from "../utils/llm-logger";
import { logger } from "../utils/logger";
import { parseJSON } from "../utils/json";
import { GENERATE_THOUGHT_SIMPLE } from "../templates/generate-thought";
import { ActionResult } from "../types/actions";
import { World, addComponent, query, hasComponent } from "bitecs";
import {
  Agent,
  GoalType,
  Memory,
  Perception,
  SinglePlanType,
  WorkingMemory,
  ProcessingState,
  ProcessingMode,
} from "../components";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { GENERATE_GOALS } from "../templates/generate-goals";
import {
  EVALUATE_GOAL_PROGRESS,
  GoalEvaluation,
} from "../templates/evaluate-goal-progress";
import { DETECT_SIGNIFICANT_CHANGES } from "../templates/detect-significant-changes";
import { StimulusData } from "../types/stimulus";

export interface ThoughtResponse {
  thought: string;
  action?: {
    tool: string;
    parameters: Record<string, any>;
  };
  appearance?: {
    description?: string;
    facialExpression?: string;
    bodyLanguage?: string;
    currentAction?: string;
    socialCues?: string;
  };
}

export interface AgentState {
  systemPrompt: string;
  name: string;
  role: string;
  thoughtHistory: string[];
  perceptions: {
    narrative: string;
    raw: StimulusData[];
  };
  lastAction: ActionResult | undefined;
  timeSinceLastAction: number | undefined;
  experiences: Array<{
    type: string;
    content: string;
    timestamp: number;
  }>;
  availableTools: Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>;
  goals?: Array<{
    id: string;
    description: string;
    priority: number;
    type: "long_term" | "short_term" | "immediate";
    status: "active" | "completed" | "failed" | "suspended";
    progress: number;
    deadline?: number;
    parentGoalId?: string;
  }>;
  activeGoals?: Array<{
    id: string;
    description: string;
    priority: number;
    type: "long_term" | "short_term" | "immediate";
    status: "active";
    progress: number;
    deadline?: number;
    parentGoalId?: string;
  }>;
  activePlans?: Array<{
    id: string;
    goalId: string;
    steps: Array<{
      id: string;
      description: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      requiredTools?: string[];
      expectedOutcome: string;
    }>;
    currentStepId?: string;
    status: "active";
  }>;
  currentPlanSteps?: Array<{
    planId: string;
    goalId: string;
    step: {
      id: string;
      description: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      requiredTools?: string[];
      expectedOutcome: string;
    };
  }>;
}

/**
 * Core LLM call with consistent error handling and system prompt
 */
async function callLLM(
  prompt: string,
  systemPrompt: string,
  agentId: string
): Promise<string> {
  try {
    llmLogger.logPrompt(agentId, prompt, systemPrompt);
    const startTime = Date.now();

    const { text } = await generateText({
      model: gemini2FlashModel,
      // model: geminiProModel,
      // model: geminiFlashModel,
      prompt,
      system: systemPrompt,
    });

    llmLogger.logResponse(agentId, text, Date.now() - startTime);

    return text || "";
  } catch (error) {
    console.error("LLM call failed:", error);
    throw error; // Let caller handle specific fallbacks
  }
}

/**
 * Template composer with type checking
 */
export function composeFromTemplate(
  template: string,
  state: Record<string, any>
): string {
  return template.replace(/\{([^}]+)\}/g, (match, path) => {
    const value = path
      .split(".")
      .reduce((obj: Record<string, any>, key: string) => obj?.[key], state);
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return value ?? match;
  });
}

export async function generateThought(
  state: AgentState
): Promise<ThoughtResponse> {
  const agentId = state.name; // Using name as ID for now

  try {
    // Format experiences chronologically with type indicators
    const formattedExperiences = state.experiences
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((exp) => {
        const time = new Date(exp.timestamp).toLocaleTimeString();
        return `[${time}] <${exp.type.toUpperCase()}> ${exp.content}`;
      })
      .join("\n");

    // Compose the prompt with formatted data
    const prompt = composeFromTemplate(GENERATE_THOUGHT_SIMPLE, {
      ...state,
      perceptions: {
        narrative: state.perceptions.narrative,
        raw: JSON.stringify(state.perceptions.raw, null, 2),
      },
      experiences: formattedExperiences,
      tools: state.availableTools
        .map((t) => `${t.name}: ${t.description}`)
        .join("\n"),
      toolSchemas: JSON.stringify(
        Object.fromEntries(
          state.availableTools.map((tool) => [
            tool.name,
            tool.schema && tool.schema._def ? zodToJsonSchema(tool.schema) : {},
          ])
        ),
        null,
        2
      ),
    });

    // Get LLM response
    const text = await callLLM(prompt, state.systemPrompt, agentId);

    try {
      // Parse and validate response
      const cleanText = text.replace(/```json\n|\n```/g, "").trim();
      const response = JSON.parse(cleanText) as ThoughtResponse;

      // Validate action if present
      if (response.action) {
        const tool = state.availableTools.find(
          (t) => t.name === response.action?.tool
        );
        if (tool) {
          try {
            tool.schema.parse(response.action.parameters);
          } catch (validationError) {
            llmLogger.logError(
              agentId,
              validationError,
              "Action validation failed"
            );
            return { thought: response.thought };
          }
        }
      }

      return {
        thought:
          response.thought || "I have nothing to think about at the moment.",
        action: response.action,
        appearance: response.appearance,
      };
    } catch (parseError) {
      llmLogger.logError(
        agentId,
        parseError,
        "Failed to parse thought response"
      );
      return {
        thought: text || "I have nothing to think about at the moment.",
      };
    }
  } catch (error) {
    console.error("Error in thought generation", error);
    llmLogger.logError(agentId, error, "Error in thought generation");
    return { thought: "My mind is blank right now." };
  }
}

export interface ProcessStimulusState {
  name: string;
  role: string;
  systemPrompt: string;
  recentPerceptions: string;
  timeSinceLastPerception: number;
  currentTimestamp: number;
  lastAction?: ActionResult;
  stimulus: StimulusData[];
  currentGoals: GoalType[];
  activePlans: SinglePlanType[];
  recentExperiences: Experience[];
  context?: {
    salientEntities: Array<{ id: number; type: string; relevance: number }>;
    roomContext: Record<string, any>;
    recentEvents: Array<{
      type: string;
      timestamp: number;
      description: string;
    }>;
    agentRole: string;
    agentPrompt: string;
    processingMode: ProcessingMode;
    stableStateCycles: number;
  };
  processingModeInstructions?: string;
  outputGuidelines?: string;
  modeSpecificAntiPatterns?: string;
  modeFocusReminder?: string;
  perceptionHistory?: string;
}

export async function processStimulus(
  state: ProcessStimulusState
): Promise<string> {
  const agentId = state.name; // Using name as ID for now

  try {
    const prompt = composeFromTemplate(PROCESS_STIMULUS, {
      ...state,
      stimulus: JSON.stringify(state.stimulus, null, 2),
    });

    // Get LLM response
    const text = await callLLM(prompt, state.systemPrompt, agentId);

    return text || "I perceive nothing of note.";
  } catch (error) {
    llmLogger.logError(agentId, error, "Error processing stimulus");
    return "I am having trouble processing my surroundings.";
  }
}

export interface Experience {
  type: "speech" | "action" | "observation" | "thought";
  content: string;
  timestamp: number;
  category?: string;
}

export interface ExtractExperiencesState {
  name: string;
  agentId: string;
  role: string;
  systemPrompt: string;
  recentExperiences: Experience[];
  timestamp: number;
  perceptionSummary: string;
  perceptionContext: any[];
  stimulus: StimulusData[];
  goals: GoalType[];
}

function validateExperiences(experiences: any[]): experiences is Experience[] {
  if (!Array.isArray(experiences)) {
    logger.error("Experiences validation failed: not an array", {
      experiences,
    });
    return false;
  }

  return experiences.every((exp) => {
    if (!exp || typeof exp !== "object") {
      logger.error("Experience validation failed: not an object", { exp });
      return false;
    }

    const validType = ["speech", "action", "observation", "thought"].includes(
      exp.type
    );
    const validContent =
      typeof exp.content === "string" && exp.content.length > 0;
    const validTimestamp =
      typeof exp.timestamp === "number" && exp.timestamp > 0;

    if (!validType || !validContent || !validTimestamp) {
      logger.error("Experience validation failed", {
        exp,
        validType,
        validContent,
        validTimestamp,
      });
      return false;
    }

    return true;
  });
}

export async function extractExperiences(
  state: ExtractExperiencesState
): Promise<Experience[]> {
  try {
    logger.debug("Extracting experiences from state:", {
      agentName: state.name,
      stimuliCount: state.stimulus.length,
      recentExperiencesCount: state.recentExperiences.length,
    });

    const prompt = composeFromTemplate(EXTRACT_EXPERIENCES, {
      ...state,
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
      stimulus: JSON.stringify(state.stimulus, null, 2),
      perceptionSummary: state.perceptionSummary,
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<{ experiences: any[] }>(text);

    // Validate experiences
    if (!validateExperiences(parsed.experiences)) {
      throw new Error("Invalid experiences format");
    }

    logger.debug("Extracted experiences:", {
      count: parsed.experiences.length,
      types: parsed.experiences.map((e) => e.type),
    });

    return parsed.experiences;
  } catch (error) {
    logger.error(`Failed to extract experiences:`, error);
    return [];
  }
}

export interface GenerateGoalsState {
  name: string;
  role: string;
  systemPrompt: string;
  agentId: string;
  currentGoals: any[];
  recentExperiences: any[];
  perceptionSummary: string;
  perceptionContext: string;
}

export interface EvaluateGoalState {
  name: string;
  systemPrompt: string;
  agentId: string;
  goalDescription: string;
  goalType: string;
  successCriteria: string[];
  progressIndicators: string[];
  currentProgress: number;
  recentExperiences: any[];
  perceptionSummary: string;
  perceptionContext: string;
}

export interface DetectChangesState {
  name: string;
  role: string;
  systemPrompt: string;
  agentId: string;
  currentGoals: any[];
  recentExperiences: any[];
  perceptionSummary: string;
  perceptionContext: string;
}

export async function generateGoals(state: GenerateGoalsState) {
  try {
    logger.debug("Generating goals for agent:", {
      agentName: state.name,
      currentGoalsCount: state.currentGoals.length,
      recentExperiencesCount: state.recentExperiences.length,
    });

    const prompt = composeFromTemplate(GENERATE_GOALS, {
      ...state,
      currentGoals: JSON.stringify(state.currentGoals, null, 2),
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<{ goals: any[] }>(text);

    logger.debug("Generated goals:", {
      count: parsed.goals.length,
      types: parsed.goals.map((g) => g.type),
    });

    return parsed.goals;
  } catch (error) {
    logger.error(`Failed to generate goals:`, error);
    return [];
  }
}

export async function evaluateGoalProgress(
  state: EvaluateGoalState
): Promise<GoalEvaluation["evaluation"]> {
  try {
    logger.debug("Evaluating goal progress:", {
      agentName: state.name,
      goalDescription: state.goalDescription,
      currentProgress: state.currentProgress,
    });

    const prompt = composeFromTemplate(EVALUATE_GOAL_PROGRESS, {
      ...state,
      successCriteria: JSON.stringify(state.successCriteria, null, 2),
      progressIndicators: JSON.stringify(state.progressIndicators, null, 2),
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<GoalEvaluation>(text);

    logger.debug("Goal evaluation:", {
      complete: parsed.evaluation.complete,
      progress: parsed.evaluation.progress,
      criteriaMetCount: parsed.evaluation.criteria_met.length,
    });

    return parsed.evaluation;
  } catch (error) {
    logger.error(`Failed to evaluate goal progress:`, error);
    return {
      complete: false,
      progress: 0,
      criteria_met: [],
      criteria_partial: [],
      criteria_blocked: [],
      recent_advancements: [],
      blockers: [],
      next_steps: [],
    };
  }
}

export async function detectSignificantChanges(state: DetectChangesState) {
  try {
    logger.debug("Detecting significant changes for agent:", {
      agentName: state.name,
      currentGoalsCount: state.currentGoals.length,
      recentExperiencesCount: state.recentExperiences.length,
    });

    const prompt = composeFromTemplate(DETECT_SIGNIFICANT_CHANGES, {
      ...state,
      currentGoals: JSON.stringify(state.currentGoals, null, 2),
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<{ analysis: any }>(text);

    logger.debug("Change analysis:", {
      significantChange: parsed.analysis.significant_change,
      changeCount: parsed.analysis.changes.length,
      recommendation: parsed.analysis.recommendation,
    });

    return parsed.analysis;
  } catch (error) {
    logger.error(`Failed to detect significant changes:`, error);
    return {
      significant_change: false,
      changes: [],
      recommendation: "maintain_goals",
      reasoning: ["Error in change detection"],
    };
  }
}

export interface GeneratePlanState {
  name: string;
  role: string;
  systemPrompt: string;
  agentId: string;
  goal: {
    id: string;
    description: string;
    type: string;
    priority: number;
    success_criteria: string[];
    progress_indicators: string[];
  };
  currentPlans: any[];
  recentExperiences: any[];
  availableTools: Array<{
    name: string;
    description: string;
    parameters: string[];
  }>;
}

export async function generatePlan(
  state: GeneratePlanState
): Promise<SinglePlanType> {
  try {
    logger.debug("Generating plan for goal:", {
      agentName: state.name,
      goalId: state.goal.id,
      goalType: state.goal.type,
    });

    const prompt = composeFromTemplate(GENERATE_PLAN, {
      ...state,
      goal: JSON.stringify(state.goal, null, 2),
      availableTools: state.availableTools
        .map((t) => `${t.name}: ${t.description}`)
        .join("\n"),
      recentExperiences: JSON.stringify(state.recentExperiences, null, 2),
    });

    const text = await callLLM(prompt, state.systemPrompt, state.agentId);
    const parsed = parseJSON<{ plan: SinglePlanType }>(text);

    logger.debug("Generated plan:", {
      planId: parsed.plan.id,
      stepCount: parsed.plan.steps.length,
    });

    // Ensure required fields are present
    return {
      ...parsed.plan,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "active" as const,
    };
  } catch (error) {
    logger.error(`Failed to generate plan:`, error);
    throw error;
  }
}
