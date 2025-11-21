
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';

export class ExecutiveFunctionLayer extends BaseLayer {

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM) {
        super(AceLayerID.EXECUTIVE_FUNCTION, bus, storage, llm);
    }

    async handleSouthbound(packet: SouthboundPacket) {
        if (packet.targetLayer === this.id && packet.type === SouthboundType.PLAN) {
            console.log(`[ExecutiveFunction] Processing Plan: ${packet.content}`);

            // 1. Generate DAG (Task Breakdown)
            const dag = await this.generateDAG(packet.content);

            // 2. Store Active Plan
            const planId = `plan:${packet.traceId}`;
            await this.storage.memory.set(planId, JSON.stringify(dag));

            // 3. Execute First Task
            if (dag.tasks.length > 0) {
                const firstTask = dag.tasks[0];
                await this.bus.publishSouthbound({
                    ...packet,
                    type: SouthboundType.INSTRUCTION,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.COGNITIVE_CONTROL,
                    content: firstTask.description,
                    parameters: { ...packet.parameters, taskId: firstTask.id, tool: firstTask.tool }
                });
            }
        }
    }

    async handleNorthbound(packet: NorthboundPacket) {
        // Log telemetry
        await this.storage.duckdb.logTelemetry(packet);

        // Handle Task Completion/Failure to trigger next task in DAG
        if (packet.sourceLayer === AceLayerID.COGNITIVE_CONTROL && (packet.type === NorthboundType.RESULT || packet.type === NorthboundType.FAILURE)) {
            // Load plan, update status, trigger next task...
            // Simplified for now
        }
    }

    private async generateDAG(plan: string): Promise<{ tasks: any[] }> {
        const prompt = `
You are the Executive Function Layer.
Break down the following plan into a list of executable tasks (DAG).
Each task should have an ID, description, and tool to use.

Plan:
"${plan}"

Output JSON format:
{
    "tasks": [
        { "id": "1", "description": "...", "tool": "..." }
    ]
}
        `;

        try {
            return await this.llm.generateStructured(prompt, {});
        } catch (e) {
            console.error("DAG generation failed", e);
            return { tasks: [] };
        }
    }
}
