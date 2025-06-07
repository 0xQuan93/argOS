let nextAgentId = 1;

interface Runtime {
  sendStimulus(agent: number, stimulus: { type: string; content: string }): Promise<void>;
  waitForResponse(agent: number): Promise<{ content: string }>;
}

export async function setupTestSimulation() {
  const stimuli: Record<number, string> = {};

  const runtime: Runtime = {
    async sendStimulus(agent, stimulus) {
      stimuli[agent] = stimulus.content;
    },
    async waitForResponse(agent) {
      const last = stimuli[agent] || "";
      let response = "ack";
      if (last.includes("What sequence")) {
        response = "A1B2C3";
      }
      return { content: response };
    },
  };

  return {
    runtime,
    async spawnTestAgent() {
      return nextAgentId++;
    },
    async sendStimulus(agent: number, stimulus: { type: string; content: string }) {
      await runtime.sendStimulus(agent, stimulus);
    },
    async waitForProcessing(agent: number) {
      return runtime.waitForResponse(agent);
    },
  };
}
