
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';
import crypto from 'crypto';

export class AgentModelLayer extends BaseLayer {

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM) {
        super(AceLayerID.AGENT_MODEL, bus, storage, llm);
    }

    async handleSouthbound(packet: SouthboundPacket) {
        if (packet.targetLayer === this.id && packet.type === SouthboundType.STRATEGY) {
            console.log(`[AgentModel] Processing Strategy: ${packet.content}`);

            // 1. Get Capabilities
            const capabilities = this.storage.sqlite.getCapabilities();

            // 2. Validate Strategy against Capabilities
            const validation = await this.validateStrategy(packet.content, capabilities);

            if (validation.valid) {
                // 3. Publish Plan to Executive Function
                await this.bus.publishSouthbound({
                    ...packet,
                    type: SouthboundType.PLAN,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.EXECUTIVE_FUNCTION,
                    content: validation.refinedPlan || packet.content,
                    parameters: { ...packet.parameters, capabilities_used: validation.usedTools }
                });
            } else {
                // 4. Emit Capability Error
                console.warn(`[AgentModel] Capability Error: ${validation.reason}`);
                await this.bus.publishNorthbound({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    traceId: packet.traceId,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.GLOBAL_STRATEGY,
                    type: NorthboundType.FAILURE, // Using FAILURE as CAPABILITY_ERROR is not in enum, or mapped to FAILURE
                    summary: `Capability Error: ${validation.reason}`,
                    data: { reason: validation.reason, missing_capabilities: validation.missingCapabilities }
                });

                // Also VETO Southbound to stop propagation? 
                // Or just let the Northbound failure trigger replanning in GSL.
            }
        }
    }

    async handleNorthbound(packet: NorthboundPacket) {
        // Log telemetry
        await this.storage.duckdb.logTelemetry(packet);
    }

    private async validateStrategy(strategy: string, capabilities: any[]): Promise<{ valid: boolean; reason?: string; missingCapabilities?: string[]; refinedPlan?: string; usedTools?: string[] }> {
        const toolsDescription = capabilities.map(c => `- ${c.tool_name}: ${c.description}`).join('\n');

        const prompt = `
You are the Agent Model Layer.
Your capabilities are:
${toolsDescription}

Analyze the following Strategy:
"${strategy}"

Determine if the agent has the necessary capabilities to execute this strategy.
If yes, refine the strategy into a high-level plan that explicitly mentions which tools to use.
If no, list the missing capabilities.

Output JSON format:
{
    "valid": boolean,
    "reason": string,
    "missingCapabilities": string[],
    "refinedPlan": string,
    "usedTools": string[]
}
        `;

        try {
            return await this.llm.generateStructured(prompt, {}); // Schema validation omitted for brevity, but recommended
        } catch (e) {
            console.error("LLM validation failed", e);
            return { valid: false, reason: "LLM validation failed" };
        }
    }
}
