import { query, removeEntity } from 'bitecs';
import { World } from '../types';
import { Stimulus } from '../components/Stimulus';
import { StimulusSource } from '../types/stimulus';
import { sendDiscordMessage } from '../discord';
import { createSystem } from './System';

const announcementChannelId = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;

export const createDiscordReportSystem = createSystem((runtime) => async (world: World) => {
    if (!announcementChannelId) {
      return world;
    }

    const entities = query(world, [Stimulus]);
    for (const eid of entities) {
      if (Stimulus.source[eid] === StimulusSource.SYSTEM) {
        try {
          const content = JSON.parse(Stimulus.content[eid]);
          const summary = `Summary of activity: ${content.data}`;
          sendDiscordMessage(announcementChannelId, summary);
        } catch (e) {
          console.error('Failed to parse stimulus content', e);
        } finally {
          removeEntity(world, eid);
        }
      }
    }

    return world;
});
