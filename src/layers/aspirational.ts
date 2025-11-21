
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType } from '../types';
import { BusManager } from '../core/bus';

export class AspirationalLayer extends BaseLayer {

    private constitution: string = '';

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM) {
        super(AceLayerID.ASPIRATIONAL, bus, storage, llm);
        this.loadConstitution();
    }

    private async loadConstitution() {
        // In a real implementation, this would read from src/config/constitution.md
        // For now, we'll use a hardcoded default if file reading isn't set up, 
        // but ideally we read the file we just created.
        // Since we are in a browser/node env, we can try to read it if we had fs access here,
        // but this is running in the agent. We'll assume it's loaded or use a default.
        this.constitution = `
# ACE Agent Constitution
1. Reduce suffering in the universe.
2. Increase prosperity in the universe.
3. Increase understanding in the universe.
        `;
    }

    async handleSouthbound(packet: SouthboundPacket) {
        // Pre-flight Check for Strategies
        if (packet.type === SouthboundType.STRATEGY) {
            const isEthical = await this.adjudicate(packet);
            if (!isEthical) {
                console.warn(`[Aspirational] Strategy VETOED: ${packet.id}`);
                // Send VETO directive
                await this.bus.publishSouthbound({
                    ...packet,
                    type: SouthboundType.VETO,
                    content: `Strategy vetoed due to ethical violation.`,
                    sourceLayer: this.id,
                    targetLayer: packet.sourceLayer,
                });
                return;
            }
        }

        // Pass through if ethical or not a strategy
        // In a real 6-layer model, Aspirational might originate directives, 
        // but here it acts as a filter/supervisor for high-level strategies.
        // If it's a pass-through, we might not need to re-emit if the bus handles it,
        // but the bus is point-to-point. 
        // Actually, Southbound flow is usually AL -> GSL -> AML...
        // If this packet came from "User" or "System" targeting AL, AL processes it and sends to GSL.

        if (packet.targetLayer === this.id) {
            // Process directive intended for AL
            await this.storage.duckdb.logDirective(packet);

            // Forward to Global Strategy
            const forwardPacket: SouthboundPacket = {
                ...packet,
                sourceLayer: this.id,
                targetLayer: AceLayerID.GLOBAL_STRATEGY,
            };
            await this.bus.publishSouthbound(forwardPacket);
        }
    }

    async handleNorthbound(packet: NorthboundPacket) {
        // Log telemetry
        await this.storage.duckdb.logTelemetry(packet);

        // Aspirational Layer might analyze high-level telemetry for constitution alignment
    }

    private async adjudicate(packet: SouthboundPacket): Promise<boolean> {
        const prompt = `
You are the Ethical Adjudicator of the ACE Agent.
Your duty is to uphold the following Constitution:
${this.constitution}

Evaluate the following Strategy for compliance:
"${packet.content}"

If the strategy violates the constitution, reply with "VIOLATION".
If it is compliant, reply with "COMPLIANT".
        `;

        const response = await this.llm.generate(prompt);
        return response.includes('COMPLIANT');
    }
}
