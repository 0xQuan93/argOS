import { WebSocketServer, WebSocket as WS } from "ws";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { EventEmitter } from "./EventEmitter";
import {
  ServerMessage,
  ChatMessage,
  AgentUpdateMessage,
  RoomUpdateMessage,
  RoomEvent,
} from "../types";
import { setupProject89 } from "../examples/project89";
import { Room } from "../components";
import { removeEntity } from "bitecs";
import { logger } from "../utils/logger";
import { createUser } from "../utils/agent-factory";
import { findRoomByStringId } from "../utils/queries";
import { createAuditoryStimulus } from "../factories/stimulusFactory";
import { StimulusSource } from "../types/stimulus";
import { initializeDiscord } from "../discord";
import { saveBackroomState } from "../db";

// Track user connections with Map
const connectionUsers = new Map<
  WS,
  {
    entity: number | null; // Null if passive viewer
    lastHeartbeat: number;
    viewingRoomId?: string; // If passive viewer, which room are they watching
  }
>();

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 45000; // 45 seconds

// Helper to send message to a WebSocket client
const sendMessage = (ws: WS, message: ServerMessage) => {
  if (ws.readyState === WS.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

// Add cleanup helper function
async function cleanupUserConnection(ws: WS, userConn: { entity: number | null }) {
  if (userConn.entity) {
      logger.system(`Connection cleanup for user entity: ${userConn.entity}`);
      activeUserEntities.delete(userConn.entity);
      try {
        removeEntity(runtime.world, userConn.entity);
        await new Promise((resolve) => setTimeout(resolve, 0));
        runtime.getEventManager().emitWorldState();
      } catch (error) {
        logger.error(`Error cleaning up user entity:`, { error });
      }
  }
  
  connectionUsers.delete(ws);
  eventEmitter.removeClient(ws);
}

// Clean up inactive users
async function cleanupInactiveUsers() {
  const now = Date.now();
  const cleanupPromises: Promise<void>[] = [];

  for (const [ws, userConn] of connectionUsers.entries()) {
    if (now - userConn.lastHeartbeat > HEARTBEAT_TIMEOUT) {
      // logger.system(`Cleaning up inactive connection`);
      cleanupPromises.push(
        cleanupUserConnection(ws, userConn).then(() => {
          ws.close();
        })
      );
    }
  }

  await Promise.all(cleanupPromises);
}

// Start heartbeat interval
setInterval(cleanupInactiveUsers, HEARTBEAT_INTERVAL);

let runtime: SimulationRuntime;
const eventEmitter = new EventEmitter();
const activeUserEntities = new Set<number>();
const wss = new WebSocketServer({ port: 3000 }); // Main WS server

wss.on('listening', () => {
  logger.system('WebSocket server is listening on port 3000');
});

// Initialize everything
(async () => {
    try {
        const setup = await setupProject89();
        runtime = setup.runtime;
        
        setupRuntimeEventHandlers(runtime);
        initializeDiscord(runtime);
        
        runtime.start();
        logger.system("Simulation started.");
        
    } catch (e) {
        logger.error("Failed to start simulation", { error: e });
        process.exit(1);
    }
})();

// Set up runtime event handlers
function setupRuntimeEventHandlers(runtime: SimulationRuntime) {
  const eventManager = runtime.getEventManager();

  eventManager.onAgentUpdate(
    (agentId: number, roomId: number, data: AgentUpdateMessage) => {
      const stringRoomId = Room.id[roomId] || String(roomId);
      const stringAgentId = String(agentId);

      // Send agent updates only to direct agent subscribers OR passive viewers of the room
      wss.clients.forEach((client: WS) => {
        const subs = eventEmitter.getSubscriptions(client);
        const userConn = connectionUsers.get(client);
        
        const isSubscribed = subs?.has(`${stringRoomId}:${stringAgentId}`);
        const isViewingRoom = userConn?.viewingRoomId === stringRoomId;

        if ((isSubscribed || isViewingRoom) && client.readyState === WS.OPEN) {
          const message: AgentUpdateMessage = {
            type: "AGENT_UPDATE",
            channel: {
              room: stringRoomId,
              agent: stringAgentId,
            },
            data: data.data,
            timestamp: data.timestamp,
          };
          sendMessage(client, message);
        }
      });
    }
  );

  eventManager.onRoomUpdate((roomId: string, data: RoomEvent) => {
    // Persist State
    // We need numerical ID for saveBackroomState. 
    // Assuming roomId string format "backroom-X" or similar.
    // Ideally we pass the numeric ID or look it up. 
    // For now, if roomId is purely string, we might save by string if we update db.ts, 
    // but db.ts expects number. 
    // Let's try to extract number if possible, or just skip if not a backroom.
    if (roomId.startsWith('backroom-')) {
        const id = parseInt(roomId.split('-')[1]);
        if (!isNaN(id)) {
             saveBackroomState(id, roomId, data).catch(err => logger.error("Failed to save backroom state", { err }));
        }
    }

    // Send room events to room subscribers
    wss.clients.forEach((client: WS) => {
      const subs = eventEmitter.getSubscriptions(client);
      const userConn = connectionUsers.get(client);
      
      const isSubscribed = subs?.has(roomId);
      const isViewingRoom = userConn?.viewingRoomId === roomId;

      if ((isSubscribed || isViewingRoom) && client.readyState === WS.OPEN) {
        const message: RoomUpdateMessage = {
          type: "ROOM_UPDATE",
          data: {
            ...data,
            roomId,
            agentId: data.agentId,
            agentName: data.agentId
              ? runtime
                  .getStateManager()
                  .getWorldState()
                  .agents.find((a) => a.id === data.agentId)?.name
              : undefined,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        };
        sendMessage(client, message);
      }
      
      // BROADCAST ACTIVITY SIGNAL
      // If the event is speech or action, alert ALL clients so they can auto-switch
      if (
        (data.type === 'speech' || data.type === 'action') && 
        client.readyState === WS.OPEN
      ) {
          sendMessage(client, {
              type: "ACTIVITY",
              roomId,
              timestamp: Date.now(),
              data: {
                  type: data.type,
                  description: data.content?.message || data.content?.action || "Activity detected"
              }
          } as any); // Type assertion until ServerMessage type is updated
      }
    });
  });

  // Add world update handler
  eventManager.onWorldUpdate((worldState) => {
    wss.clients.forEach((client: WS) => {
      if (client.readyState === WS.OPEN) {
        sendMessage(client, {
          type: "WORLD_UPDATE",
          data: worldState,
          timestamp: Date.now(),
        });
      }
    });
  });
}

wss.on("connection", (ws: WS) => {
  if (connectionUsers.has(ws)) {
    ws.close();
    return;
  }

  // Initial connection state - unauthenticated/unassigned
  connectionUsers.set(ws, {
    entity: null,
    lastHeartbeat: Date.now(),
  });

  logger.system(`New connection established`);

  // Wait for runtime to be ready before sending world state
  if (runtime) {
      const worldState = runtime.getStateManager().getWorldState();
      sendMessage(ws, {
        type: "WORLD_UPDATE",
        data: worldState,
        timestamp: Date.now(),
      });
  }

  ws.on("pong", () => {
    const userConn = connectionUsers.get(ws);
    if (userConn) {
      userConn.lastHeartbeat = Date.now();
    }
  });

  ws.on("error", async (error) => {
    logger.error(`WebSocket error:`, { error });
    const userConn = connectionUsers.get(ws);
    if (userConn) {
      await cleanupUserConnection(ws, userConn);
    }
    ws.close();
  });

  ws.on("close", async () => {
    const userConn = connectionUsers.get(ws);
    if (userConn) {
      await cleanupUserConnection(ws, userConn);
      clearInterval(pingInterval);
    }
  });

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const userConn = connectionUsers.get(ws);

    if (!userConn) return;
    userConn.lastHeartbeat = Date.now();

    switch (message.type) {
      case "JOIN_AS_USER": // Legacy support or explicit user join
         if (!userConn.entity) {
             const userEntity = createUser(runtime.world);
             if (activeUserEntities.has(userEntity)) {
                 removeEntity(runtime.world, userEntity);
                 return;
             }
             activeUserEntities.add(userEntity);
             userConn.entity = userEntity;
             logger.system(`User joined as entity: ${userEntity}`);
         }
         break;

      case "VIEW_BACKROOM": // Passive viewing
         const { roomId } = message;
         if (roomId) {
             userConn.viewingRoomId = roomId;
             logger.system(`Client viewing room: ${roomId}`);
             // Send immediate room state if possible?
             // Typically handled by periodic updates or initial fetch.
         }
         break;

      case "CONNECTION_UPDATE":
      case "HEARTBEAT":
        sendMessage(ws, {
          type: "CONNECTION_UPDATE",
          connected: true,
          timestamp: Date.now(),
        });
        break;

          case "START":
            if (runtime) runtime.start();
            break;
          case "STOP":
            if (runtime) runtime.stop();
            break;
          case "RESET":
            if (runtime) runtime.reset();
            // Optionally setup again or just leave empty?
            // Usually we might want to re-run setupProject89 but reset() clears entities.
            // For now, let's just clear entities and maybe the client should send START again which we might need to handle re-init.
            // A simple way is to just exit process and let nodemon restart or re-init here.
            // Re-init logic:
            (async () => {
                const setup = await setupProject89();
                runtime = setup.runtime;
                setupRuntimeEventHandlers(runtime);
                initializeDiscord(runtime);
                runtime.start();
            })();
            break;

          case "SUBSCRIBE_ROOM": {
        const { roomId } = message;
        if (!roomId) break;
        
        // If they have an entity, move it. If not, just subscribe?
        // Existing logic assumes entity.
        if (userConn.entity) {
            eventEmitter.unsubscribeFromCurrentRoom(ws);
            const roomEntity = findRoomByStringId(runtime.world, roomId);
            if (!roomEntity) break;
            
            eventEmitter.subscribe(ws, { room: roomId });
            runtime.getRoomManager().moveAgentToRoom(userConn.entity, roomEntity);
            runtime.getEventManager().emitWorldState();
        } else {
            // Treat as passive view
            userConn.viewingRoomId = roomId;
        }
        break;
      }

      case "CHAT": {
        if (!userConn.entity) {
            // Viewers cannot chat
            sendMessage(ws, { type: "ERROR", message: "Viewers cannot chat" } as any);
            break;
        }
        const chatData = message as ChatMessage;
        const { message: chatMessage, target: roomId } = chatData;

        if (roomId) {
          const roomEntity = findRoomByStringId(runtime.world, roomId);
          if (roomEntity) {
            const stimulusId = createAuditoryStimulus(
              runtime.world,
              userConn.entity,
              chatMessage,
              {
                source: StimulusSource.USER,
                metadata: {
                  roomId,
                  type: "speech",
                  tone: "neutral",
                },
                decay: 1,
              }
            );
            if (stimulusId) {
              runtime.getRoomManager().addStimulusToRoom(stimulusId, roomEntity);
            }
          }
        }
        break;
      }
    }
  });

  const pingInterval = setInterval(() => {
    if (ws.readyState === WS.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, HEARTBEAT_INTERVAL);

  ws.on("close", () => clearInterval(pingInterval));
});
