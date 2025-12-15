import { query, removeEntity, removeComponent } from 'bitecs';
import { World } from '../types';
import { Report } from '../components/Report';
import { reportRequests, sendDiscordMessage } from '../discord';
import { Agent } from '../components/Agent';
import { createSystem } from './System';

export const createReportingSystem = createSystem((runtime) => async (world: any) => {
    const reports = query(world, [Report]);
    for (const eid of reports) {
      const requestId = Report.requestId[eid];
      const channelId = reportRequests.get(requestId);

      if (channelId) {
        const agents = query(world, [Agent]);
        const reportMessage = `Report: There are currently ${agents.length} agents in the simulation.`;
        sendDiscordMessage(channelId, reportMessage);

        reportRequests.delete(requestId);
        removeComponent(world, eid, Report);
        removeEntity(world, eid);
      }
    }
    return world;
});
