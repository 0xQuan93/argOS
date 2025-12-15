import { z } from "zod";
import { logger } from "../utils/logger";
import { EventBus } from "../runtime/EventBus";
import { getAgentRoom } from "../utils/queries";
import { ActionContent, World } from "../types";
import { ActionResultType, Agent, Room } from "../components";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { query } from "bitecs";

export const schema = z
  .object({
    targetRoomName: z
      .string()
      .describe(
        "The name or ID of the room you want to move to. e.g., 'Backroom-1', 'Backroom-2'."
      ),
  })
  .describe("Move to a different room in the simulation");

export const action = {
  name: "move",
  description:
    "Move your presence to another room to explore or find other agents.",
  parameters: ["targetRoomName"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus,
  runtime: SimulationRuntime
): Promise<ActionResultType> {
  const currentRoomId = getAgentRoom(world, eid);
  if (!currentRoomId) {
    return {
      success: false,
      result: "Cannot move - you are not in any room",
      timestamp: Date.now(),
      action: "move",
      data: {
        entityId: eid,
        metadata: {
          error: "Agent not in room",
        },
      },
    };
  }

  // Find target room
  const rooms = query(world, [Room]);
  let targetRoomId: number | null = null;
  
  for (const roomId of rooms) {
    const name = Room.name[roomId];
    const id = Room.id[roomId];
    
    // Match by exact name or ID (case insensitive)
    if (
      name.toLowerCase() === parameters.targetRoomName.toLowerCase() ||
      id.toLowerCase() === parameters.targetRoomName.toLowerCase()
    ) {
      targetRoomId = roomId;
      break;
    }
    
    // Fuzzy match for "Backroom X" if input is just "X" or "Room X"
    if (parameters.targetRoomName.match(/backroom/i)) {
         if (name.toLowerCase().includes(parameters.targetRoomName.toLowerCase())) {
             targetRoomId = roomId;
             break;
         }
    }
  }

  if (!targetRoomId) {
     // Check if input was just a number "1" -> "Backroom-1"
     const numericMatch = parameters.targetRoomName.match(/\d+/);
     if (numericMatch) {
         const num = numericMatch[0];
         for (const roomId of rooms) {
             if (Room.name[roomId] === `Backroom-${num}`) {
                 targetRoomId = roomId;
                 break;
             }
         }
     }
  }

  if (!targetRoomId) {
    return {
      success: false,
      result: `Could not find a room named "${parameters.targetRoomName}". Available rooms are: ${rooms.map(r => Room.name[r]).join(", ")}`,
      timestamp: Date.now(),
      action: "move",
      data: {
        entityId: eid,
        metadata: {
          error: "Target room not found",
        },
      },
    };
  }

  if (targetRoomId === currentRoomId) {
      return {
      success: false,
      result: `You are already in ${Room.name[currentRoomId]}.`,
      timestamp: Date.now(),
      action: "move",
      data: {
        entityId: eid,
        metadata: {
          error: "Already in target room",
        },
      },
    };
  }

  const result = `Moving from ${Room.name[currentRoomId]} to ${Room.name[targetRoomId]}...`;
  
  // Log the action
  logger.agent(eid, result, Agent.name[eid]);

  const actionContent: ActionContent = {
    action: "move",
    result,
    parameters,
    agentName: Agent.name[eid],
  };

  // Emit event in old room BEFORE moving
  eventBus.emitRoomEvent(currentRoomId, "action", actionContent, String(eid));

  // Execute the move
  runtime.getRoomManager().moveAgentToRoom(eid, targetRoomId);

  // Emit event in new room AFTER moving
  const arrivalContent: ActionContent = {
      action: "move",
      result: `${Agent.name[eid]} arrived from ${Room.name[currentRoomId]}.`,
      parameters,
      agentName: Agent.name[eid]
  };
  eventBus.emitRoomEvent(targetRoomId, "action", arrivalContent, String(eid));

  return {
    success: true,
    action: "move",
    result: `Successfully moved to ${Room.name[targetRoomId]}`,
    timestamp: Date.now(),
    data: {
      entityId: eid,
      metadata: {
        fromRoom: Room.name[currentRoomId],
        toRoom: Room.name[targetRoomId],
      },
    },
  };
}

