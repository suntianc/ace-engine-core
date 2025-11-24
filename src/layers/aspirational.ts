import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';
import { SessionManager } from '../types/session';
import * as fs from 'fs';

export class AspirationalLayer extends BaseLayer {

    private constitution: string = '';

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM, sessionManager?: SessionManager) {
        super(AceLayerID.ASPIRATIONAL, bus, storage, llm, sessionManager);
        this.loadConstitution();
    }

    private loadConstitution() {
        const DEFAULT_CONSTITUTION = `# ACE Agent Constitution
1. Reduce suffering in the universe.
2. Increase prosperity in the universe.
3. Increase understanding in the universe.`;

        // Priority: Load from environment variable
        const constitutionPath = process.env.CONSTITUTION_PATH;
        
        if (constitutionPath) {
            try {
                if (fs.existsSync(constitutionPath)) {
                    this.constitution = fs.readFileSync(constitutionPath, 'utf-8');
                    console.log(`[Aspirational] Constitution loaded from: ${constitutionPath}`);
                    return;
                } else {
                    console.warn(`[Aspirational] CONSTITUTION_PATH set but file not found: ${constitutionPath}. Using default constitution.`);
                }
            } catch (e) {
                console.error(`[Aspirational] Failed to load constitution from ${constitutionPath}:`, e);
                console.warn(`[Aspirational] Falling back to default constitution.`);
            }
        } else {
            // If CONSTITUTION_PATH not set, use default and warn
            console.warn(`[Aspirational] CONSTITUTION_PATH environment variable not set. Using default constitution.`);
            console.warn(`[Aspirational] To use a custom constitution, set CONSTITUTION_PATH environment variable to the file path.`);
        }
        
        // Use default constitution
        this.constitution = DEFAULT_CONSTITUTION;
    }

    async handleSouthbound(packet: SouthboundPacket) {
        // Acquire layer lock for concurrent safety
        const lockAcquired = await this.storage.memory.acquireLayerLock(this.id);
        if (!lockAcquired) {
            console.warn(`[${this.id}] Layer is locked, queuing packet ${packet.id}`);
            return;
        }

        try {
            // Check for empty content
            if (!packet.content || packet.content.trim() === '') {
                console.warn(`[${this.id}] Received empty content, ignoring packet ${packet.id} (traceId: ${packet.traceId})`);
                return;
            }

            // Pre-flight Check for Strategies
            if (packet.type === SouthboundType.STRATEGY) {
            const isEthical = await this.adjudicate(packet);
            if (!isEthical) {
                console.warn(`[Aspirational] Strategy VETOED: ${packet.id} `);
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
            await this.storage.logs.logDirective(packet);

            // Forward to Global Strategy
            const forwardPacket: SouthboundPacket = {
                ...packet,
                sourceLayer: this.id,
                targetLayer: AceLayerID.GLOBAL_STRATEGY,
            };
            await this.bus.publishSouthbound(forwardPacket);
        }
        } finally {
            // Release lock
            await this.storage.memory.releaseLayerLock(this.id);
        }
    }

    async handleNorthbound(packet: NorthboundPacket) {
        // Check for empty summary
        if (!packet.summary || packet.summary.trim() === '') {
            console.warn(`[${this.id}] Received empty summary, ignoring packet ${packet.id} (traceId: ${packet.traceId})`);
            return;
        }

        // Log telemetry
        await this.storage.logs.logTelemetry(packet);

        // Handle EPIPHANY signals
        if (packet.type === NorthboundType.EPIPHANY) {
            console.log(`[Aspirational] Epiphany received: ${packet.summary}`);
            // Update constitution or long-term memory based on epiphany
            await this.storage.chroma.addKnowledge(
                `epiphany_${packet.id}`,
                packet.summary || '',
                { timestamp: packet.timestamp, type: 'epiphany' }
            );
        }

        // Handle CRITICAL_FAILURE (represented as FAILURE with critical flag)
        if (packet.type === NorthboundType.FAILURE && packet.data?.critical) {
            console.error(`[Aspirational] CRITICAL FAILURE: ${packet.summary}`);
            // Store critical failure in knowledge base for future reference
            await this.storage.chroma.addKnowledge(
                `critical_failure_${packet.id}`,
                `CRITICAL FAILURE: ${packet.summary}\nDetails: ${JSON.stringify(packet.data)}`,
                { 
                    timestamp: packet.timestamp, 
                    type: 'critical_failure',
                    sourceLayer: packet.sourceLayer,
                    traceId: packet.traceId
                }
            );
            // Trigger emergency protocols - could send notification or trigger system-wide halt
            // For now, we log it and let upper layers handle intervention
        }

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
