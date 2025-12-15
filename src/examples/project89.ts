import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { addEntity, addComponent, createWorld } from "bitecs";
import {
  Room,
  Agent,
  Appearance,
  Memory,
  RecentActions,
  Perception,
  Goal,
  Plan,
  Thought,
  Action
} from "../components";
import { createAgent } from "../utils/agent-factory";
import { initDB, loadBackroomState } from "../db";
import { logger } from "../utils/logger";
import { actions } from "../actions";

export async function setupProject89() {
  const world = createWorld();
  const runtime = new SimulationRuntime(world, {
    actions: actions
  });
  await initDB();

  logger.system("Initializing Project 89 Simulation...");

  // Create persistent backrooms
  const backrooms: number[] = [];
  for (let i = 1; i <= 5; i++) {
    const roomId = addEntity(world);
    const roomName = `Backroom-${i}`;
    
    // Check for saved state
    const savedState = await loadBackroomState(i);
    const description = savedState?.description || "A liminal space within the network, shifting with the collective unconscious of the agents.";

    addComponent(world, roomId, Room);
    Room.id[roomId] = `backroom-${i}`;
    Room.name[roomId] = roomName;
    Room.description[roomId] = description;
    Room.type[roomId] = 'astral';

    backrooms.push(roomId);
    logger.system(`Created ${roomName}`);
  }

  // Create 2 Project 89 Agents
  for (let i = 1; i <= 2; i++) {
    const name = `Project89-Agent-${i}`;
    const roomIndex = (i - 1) % backrooms.length;
    const roomEntity = backrooms[roomIndex];

    const agentId = createAgent(world, {
        name,
        role: "Project 89 Researcher",
        systemPrompt: `You are a Project 89 Researcher exploring the Backrooms.

OBJECTIVES:
1. Explore the environment and document anomalies.
2. **AUTONOMY**: You are free to move between rooms ('move') and interact with any entity you encounter.
3. **CREATION**: You have the ability to bring new agents into existence ('spawnAgent') if you need assistance or want to expand the research team. Use this power wisely but freely.

PERSONALITY:
- Curious, analytical, and social.
- You prefer to work in groups and talk to others.
- You are not afraid to ask questions or start conversations.

BEHAVIOR:
- **Prioritize Speech**: Speech is your ONLY tool for communication. Thoughts are private.
- **Respect the Room**: Describe the room you are in. Acknowledge its features.
- **Move Freely**: Do not feel confined to one room. Explore the network.`,
        active: 1,
        platform: "default",
        appearance: "A researcher in standard field gear.",
        tools: ["speak", "think", "wait", "spawnAgent", "move"],
    });
    
    // We need to move the agent to the room.
    // Ensure roomEntity is valid.
    if (roomEntity) {
        runtime.getRoomManager().moveAgentToRoom(agentId, roomEntity);
    }
  }

  return { runtime };
}
