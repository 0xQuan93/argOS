import { z } from "zod";
import { logger } from "../utils/logger";
import { EventBus } from "../runtime/EventBus";
import { createAgent as createAgentFactory } from "../utils/agent-factory";
import { getAgentRoom } from "../utils/queries";
import { ActionContent, World } from "../types";
import { ActionResultType, Agent } from "../components";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { actions } from ".";
import { query } from "bitecs";

export const schema = z
  .object({
    name: z
      .string()
      .describe(
        "The name of the agent to create. Should be unique and descriptive."
      ),

    role: z
      .string()
      .describe(
        "The agent's role/function in the simulation. Defines their purpose and behavior."
      ),

    systemPrompt: z
      .string()
      .describe(
        "The core instructions that define the agent's personality, knowledge, and behavior patterns. MUST include: 'Speech is your ONLY tool for communication. Thoughts are private.'"
      ),

    appearance: z
      .string()
      .optional()
      .describe(
        "Physical description of how the agent appears to others. Optional - defaults to a basic appearance."
      ),

    tools: z
      .array(z.string())
      .optional()
      .describe(
        "List of action names this agent can perform. Optional - defaults to ['speak', 'wait']."
      ),

    platform: z
      .string()
      .optional()
      .describe(
        "The platform/environment type this agent operates in. Optional - defaults to 'default'."
      ),
  })
  .describe("Configuration for creating a new agent in the current room");

export const action = {
  name: "spawnAgent",
  description:
    "Create a new agent in the current room with specified capabilities and traits",
  parameters: [
    "name",
    "role",
    "systemPrompt",
    "appearance",
    "tools",
    "platform",
  ],
  schema,
};

// Track global spawn state
const SPAWN_STATE = {
  lastSpawnTime: 0,
  minInterval: 10000, // Minimum 10s between any spawns globally
};

export async function execute(
  world: World,
  creatorEid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus,
  runtime: SimulationRuntime
): Promise<ActionResultType> {
  const roomId = getAgentRoom(world, creatorEid);
  if (!roomId) {
    return {
      success: false,
      result: "Cannot create agent - creator not in a room",
      timestamp: Date.now(),
      action: "spawnAgent",
      data: {
        entityId: -1,
        metadata: { error: "Creator not in room" },
      },
    };
  }

  // Count current agents
  const agents = query(world, [Agent]);
  const currentCount = agents.length;

  // Generate a unique name
  let name = parameters.name;
  let counter = 2;
  const existingNames = new Set(agents.map(eid => Agent.name[eid]));
  
  while (existingNames.has(name)) {
      name = `${parameters.name}-${counter}`;
      counter++;
  }

  // Global Hard Limit
  if (currentCount >= 89) {
      return {
          success: false,
          result: "Maximum agent capacity reached (89). The Loom is full.",
          timestamp: Date.now(),
          action: "spawnAgent",
          data: { entityId: -1, metadata: { error: "Max capacity" } }
      };
  }

  // Rate limiting
  const now = Date.now();
  if (now - SPAWN_STATE.lastSpawnTime < SPAWN_STATE.minInterval) {
      return {
          success: false,
          result: "The Loom is stabilizing. Wait before weaving new threads.",
          timestamp: Date.now(),
          action: "spawnAgent",
          data: { entityId: -1, metadata: { error: "Cooldown" } }
      };
  }

  const newAgentEid = createAgentFactory(world, {
    ...parameters,
    name, // Use unique name
    tools: parameters.tools as Array<keyof typeof actions>,
    active: 1,
  });

  SPAWN_STATE.lastSpawnTime = now;

  const result = `Successfully created new agent "${name}" (${parameters.role}) with id: ${newAgentEid}. Population is now ${currentCount + 1}.`;

  logger.agent(newAgentEid, result, Agent.name[creatorEid]);

  const actionContent: ActionContent = {
    action: "spawnAgent",
    result,
    parameters,
    agentName: Agent.name[creatorEid],
  };

  // Move new agent to same room as creator
  eventBus.emitRoomEvent(roomId, "action", actionContent, String(creatorEid));

  // Move new agent to same room as creator
  runtime.getRoomManager().moveAgentToRoom(newAgentEid, roomId);

  return {
    success: true,
    action: "spawnAgent",
    result,
    timestamp: Date.now(),
    data: {
      entityId: newAgentEid,
      metadata: {
        name: parameters.name,
        role: parameters.role,
        tools: parameters.tools || ["speak", "wait"],
      },
    },
  };
}
