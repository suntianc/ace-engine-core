import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';
import crypto from 'crypto';

export class CognitiveControlLayer extends BaseLayer {

    private failureCount: number = 0;
    private static FRUSTRATION_THRESHOLD = 3;

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM) {
        super(AceLayerID.COGNITIVE_CONTROL, bus, storage, llm);
    }

    async handleSouthbound(packet: SouthboundPacket) {
        if (packet.targetLayer === this.id && packet.type === SouthboundType.INSTRUCTION) {
            console.log(`[CognitiveControl] Processing Instruction: ${packet.content}`);

            // Reset failure count on new instruction
            this.failureCount = 0;

            // Forward to Task Prosecution as CONTROL
            await this.bus.publishSouthbound({
                ...packet,
                type: SouthboundType.CONTROL,
                sourceLayer: this.id,
                targetLayer: AceLayerID.TASK_PROSECUTION,
            });
        }
    }

    async handleNorthbound(packet: NorthboundPacket) {
        // Log telemetry
        await this.storage.duckdb.logTelemetry(packet);

        // Log Metrics
        await this.storage.duckdb.run(`
            INSERT INTO metrics (name, value, tags, timestamp) VALUES (?, ?, ?, ?)
        `, ['packet_throughput', 1, JSON.stringify({ layer: this.id, type: packet.type }), new Date()]);

        // Handle Failure & Frustration
        if (packet.sourceLayer === AceLayerID.TASK_PROSECUTION && packet.type === NorthboundType.FAILURE) {
            this.failureCount++;
            console.warn(`[CognitiveControl] Task Failure (${this.failureCount}/${CognitiveControlLayer.FRUSTRATION_THRESHOLD})`);

            if (this.failureCount >= CognitiveControlLayer.FRUSTRATION_THRESHOLD) {
                console.error(`[CognitiveControl] Frustration Threshold Exceeded! Emitting Signal.`);

                // Emit Frustration Signal
                await this.bus.publishNorthbound({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    traceId: packet.traceId,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.GLOBAL_STRATEGY, // Or Executive Function
                    type: NorthboundType.FRUSTRATION_SIGNAL,
                    summary: `Frustration threshold exceeded for task: ${packet.summary}`,
                    data: { failureCount: this.failureCount }
                });

                // Reset? Or let upper layers handle intervention
            }
        }
    }
}
