
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';
import crypto from 'crypto';

export class AgentModelLayer extends BaseLayer {
    private static DEFAULT_RISK_THRESHOLD = 3; // Default threshold (1-5 scale)
    private riskThreshold: number;

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM, riskThreshold?: number) {
        super(AceLayerID.AGENT_MODEL, bus, storage, llm);
        // Validate risk threshold is in 1-5 range
        const threshold = riskThreshold ?? AgentModelLayer.DEFAULT_RISK_THRESHOLD;
        if (threshold < 1 || threshold > 5) {
            console.warn(`[AgentModel] Invalid risk threshold ${threshold}. Must be between 1-5. Using default: ${AgentModelLayer.DEFAULT_RISK_THRESHOLD}`);
            this.riskThreshold = AgentModelLayer.DEFAULT_RISK_THRESHOLD;
        } else {
            this.riskThreshold = threshold;
        }
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

            if (packet.targetLayer === this.id && packet.type === SouthboundType.STRATEGY) {
            console.log(`[AgentModel] Processing Strategy: ${packet.content}`);

            // 1. Get Capabilities
            const capabilities = this.storage.sqlite.getCapabilities();

            // 2. Check if any required capabilities exceed risk threshold
            const highRiskCapabilities = capabilities.filter((cap: any) => 
                cap.is_active && cap.risk_level && cap.risk_level > this.riskThreshold
            );

            if (highRiskCapabilities.length > 0) {
                console.warn(`[AgentModel] High-risk capabilities detected: ${highRiskCapabilities.map((c: any) => c.tool_name).join(', ')}`);
            }

            // 3. Validate Strategy against Capabilities
            const validation = await this.validateStrategy(packet.content, capabilities);

            // 4. Check risk level from validation
            if (validation.riskLevel && validation.riskLevel > this.riskThreshold) {
                console.warn(`[AgentModel] Strategy rejected due to high risk level: ${validation.riskLevel} > ${this.riskThreshold}`);
                await this.bus.publishNorthbound({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    traceId: packet.traceId,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.GLOBAL_STRATEGY,
                    type: NorthboundType.CAPABILITY_ERROR,
                    summary: `Strategy rejected: Risk level ${validation.riskLevel} exceeds threshold ${this.riskThreshold}`,
                    data: { 
                        reason: `Risk level too high: ${validation.riskLevel}`,
                        riskLevel: validation.riskLevel,
                        threshold: this.riskThreshold,
                        original_strategy: packet.content
                    }
                });
                return;
            }

            if (validation.valid) {
                // 5. Publish Plan to Executive Function
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
                    type: NorthboundType.CAPABILITY_ERROR,
                    summary: `Capability Error: ${validation.reason}`,
                    data: { 
                        reason: validation.reason, 
                        missing_capabilities: validation.missingCapabilities,
                        original_strategy: packet.content
                    }
                });

                // Also VETO Southbound to stop propagation? 
                // Or just let the Northbound failure trigger replanning in GSL.
            }
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
        await this.storage.duckdb.logTelemetry(packet);
    }

    private async validateStrategy(strategy: string, capabilities: any[]): Promise<{ valid: boolean; reason?: string; missingCapabilities?: string[]; refinedPlan?: string; usedTools?: string[]; riskLevel?: number }> {
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
            const analysis = await this.llm.generateStructured<{
                valid: boolean;
                reason?: string;
                missingCapabilities?: string[];
                refinedPlan?: string;
                usedTools?: string[];
                risk_level: number; // 1-5 scale per design document
            }>(prompt, {});

            // Normalize risk level to 1-5 scale (in case LLM returns 1-10 scale)
            let normalizedRiskLevel = analysis.risk_level;
            if (normalizedRiskLevel > 5) {
                // If LLM returned 1-10 scale, normalize to 1-5
                normalizedRiskLevel = Math.ceil(normalizedRiskLevel / 2);
            }
            if (normalizedRiskLevel < 1) normalizedRiskLevel = 1;
            if (normalizedRiskLevel > 5) normalizedRiskLevel = 5;

            // Return analysis with normalized riskLevel
            return {
                ...analysis,
                riskLevel: normalizedRiskLevel
            };
        } catch (e) {
            console.error("LLM validation failed", e);
            return { valid: false, reason: "LLM validation failed" };
        }
    }
}
