
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType } from '../types';
import { BusManager } from '../core/bus';

export class GlobalStrategyLayer extends BaseLayer {

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM) {
        super(AceLayerID.GLOBAL_STRATEGY, bus, storage, llm);
    }

    async handleSouthbound(packet: SouthboundPacket) {
        if (packet.targetLayer === this.id) {
            console.log(`[GlobalStrategy] Processing directive: ${packet.content}`);

            // 1. Contextualize
            const context = await this.contextualize(packet);

            // 2. Generate Strategy
            const strategy = await this.generateStrategy(packet, context);

            // 3. Publish Strategy to Agent Model
            await this.bus.publishSouthbound({
                ...packet,
                type: SouthboundType.STRATEGY,
                sourceLayer: this.id,
                targetLayer: AceLayerID.AGENT_MODEL,
                content: strategy,
                parameters: { original_directive: packet.id }
            });
        }
    }

    async handleNorthbound(packet: NorthboundPacket) {
        // Log telemetry
        await this.storage.duckdb.logTelemetry(packet);
    }

    private async contextualize(packet: SouthboundPacket): Promise<string> {
        // Query relevant episodic memories
        const queryResponse = await this.storage.chroma.queryEpisodic(packet.content, 3);
        const memories = queryResponse.documents[0] || [];

        // Query recent telemetry from DuckDB (mock query for now as DuckDB adapter might need specific query method)
        // const recentLogs = await this.storage.duckdb.query("SELECT * FROM telemetry_log ORDER BY timestamp DESC LIMIT 5");

        return `
Relevant Memories:
${memories.join('\n')}

Directive:
${packet.content}
        `;
    }

    private async generateStrategy(_packet: SouthboundPacket, context: string): Promise<string> {
        const prompt = `
You are the Global Strategy Layer of the ACE Agent.
Based on the following context, generate a high-level strategy (list of milestones) to achieve the directive.

Context:
${context}

Output the strategy as a numbered list of milestones.
        `;

        return await this.llm.generate(prompt);
    }
}
