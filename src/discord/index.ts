import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import { SimulationRuntime } from '../runtime/SimulationRuntime';
import { addEntity, addComponent } from 'bitecs';
import { Report } from '../components/Report';
import { StimulusComponent as Stimulus } from '../components/Stimulus';
import { StimulusSource, StimulusType } from '../types/stimulus';

dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const monitorChannelId = process.env.DISCORD_MONITOR_CHANNEL_ID;

let client: Client | null = null;

if (!token || token === 'dummy') {
  console.warn('DISCORD_BOT_TOKEN is not defined or dummy. Discord features disabled.');
} else {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.once('ready', () => {
      console.log('Discord client is ready!');
    });

    client.login(token).catch(err => {
        console.warn('Failed to login to Discord, likely invalid token. Continuing without Discord.', err.message);
        client = null;
    });
}

export const reportRequests = new Map<number, string>();
let reportRequestId = 0;

export const sendDiscordMessage = (channelId: string, message: string) => {
  if (!client) return;
  const channel = client.channels.cache.get(channelId);
  if (channel && channel.isTextBased()) {
    (channel as TextChannel).send(message);
  }
};

export const initializeDiscord = (runtime: SimulationRuntime) => {
  if (!client || !token || token === 'dummy') return;

  client.on('messageCreate', (message) => {
    if (message.author.bot) return;

    if (message.content === '!report') {
      const eid = addEntity(runtime.world);
      addComponent(runtime.world, eid, Report);
      const requestId = reportRequestId++;
      reportRequests.set(requestId, message.channel.id);
      Report.requestId[eid] = requestId;
    } else if (message.channel.id === monitorChannelId) {
      const eid = addEntity(runtime.world);
      // Modern bitECS set pattern if set is not available:
      addComponent(runtime.world, eid, Stimulus);
      Stimulus.source[eid] = StimulusSource.SYSTEM;
      Stimulus.type[eid] = StimulusType.AUDITORY;
      Stimulus.content[eid] = JSON.stringify({
          data: `A message was posted in the monitored channel: "${message.content}" by ${message.author.tag}`,
      });
      Stimulus.timestamp[eid] = Date.now();
    }
  });

  // Client login is handled in initialization
};
