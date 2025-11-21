import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';
import crypto from 'crypto';

export enum FocusState {
    IDLE = 'IDLE',
    EXECUTING = 'EXECUTING',
    BLOCKED = 'BLOCKED',
    FRUSTRATED = 'FRUSTRATED'
}

export class CognitiveControlLayer extends BaseLayer {

    private static FRUSTRATION_THRESHOLD = 3;
    private failureCount: number = 0;
    private state: FocusState = FocusState.IDLE;

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM) {
        super(AceLayerID.COGNITIVE_CONTROL, bus, storage, llm);
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

            if (packet.targetLayer === this.id && packet.type === SouthboundType.INSTRUCTION) {
            console.log(`[CognitiveControl] Processing Instruction: ${packet.content} `);

            // Transition from IDLE or FRUSTRATED to EXECUTING
            this.failureCount = 0;
            this.setState(FocusState.EXECUTING, `Starting new task: ${packet.content}`);

            // Forward to Task Prosecution as CONTROL
            await this.bus.publishSouthbound({
                ...packet,
                type: SouthboundType.CONTROL,
                sourceLayer: this.id,
                targetLayer: AceLayerID.TASK_PROSECUTION,
            });
        } else if (packet.type === SouthboundType.CONTROL && packet.content === 'BLOCKED') {
            // Handle blocking signal (e.g., waiting for external resource)
            this.setState(FocusState.BLOCKED, 'Task blocked, waiting for resource');
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

        // Log Metrics - Schema: ts, layer, metric_name, value
        await this.storage.duckdb.run(`
            INSERT INTO metrics(ts, layer, metric_name, value) VALUES(?, ?, ?, ?)
    `, [new Date(), this.id, 'packet_throughput', 1]);

        // Handle Success - transition to IDLE
        if (packet.sourceLayer === AceLayerID.TASK_PROSECUTION && packet.type === NorthboundType.RESULT) {
            if (this.state === FocusState.EXECUTING || this.state === FocusState.BLOCKED) {
                this.failureCount = 0;
                this.setState(FocusState.IDLE, 'Task completed successfully');
            }
        }

        // Handle Failure & Frustration
        if (packet.sourceLayer === AceLayerID.TASK_PROSECUTION && packet.type === NorthboundType.FAILURE) {
            this.failureCount++;
            console.warn(`[CognitiveControl] Task Failure(${this.failureCount} / ${CognitiveControlLayer.FRUSTRATION_THRESHOLD})`);

            if (this.failureCount >= CognitiveControlLayer.FRUSTRATION_THRESHOLD) {
                console.error(`[CognitiveControl] Frustration Threshold Exceeded! Emitting Signal.`);
                this.setState(FocusState.FRUSTRATED, `Frustration threshold exceeded after ${this.failureCount} failures`);

                // Emit Frustration Signal
                await this.bus.publishNorthbound({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    traceId: packet.traceId,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.GLOBAL_STRATEGY, // Or Executive Function
                    type: NorthboundType.FRUSTRATION_SIGNAL,
                    summary: `Frustration threshold exceeded for task: ${packet.summary} `,
                    data: { failureCount: this.failureCount }
                });

                // Reset failure count after emitting signal, but keep FRUSTRATED state
                // Upper layers will handle intervention and may reset state
            } else if (this.state === FocusState.EXECUTING) {
                // Still under threshold, can retry
                console.log(`[CognitiveControl] Failure count ${this.failureCount}, will retry`);
            }
        }
    }

    getFocusState(): FocusState {
        return this.state;
    }

    private setState(newState: FocusState, reason: string) {
        if (this.state !== newState) {
            const previousState = this.state;
            this.state = newState;
            console.log(`[CognitiveControl] State transition: ${previousState} -> ${newState} (${reason})`);
            
            // Log state transition to telemetry - Schema: ts, layer, metric_name, value
            (async () => {
                try {
                    await this.storage.duckdb.run(`
                        INSERT INTO metrics(ts, layer, metric_name, value) VALUES(?, ?, ?, ?)
                    `, [
                        new Date(),
                        this.id,
                        'focus_state_transition',
                        1
                    ]);
                } catch (err) {
                    console.error('[CognitiveControl] Failed to log state transition:', err);
                }
            })();
        }
    }

    resetState() {
        this.setState(FocusState.IDLE, 'State reset by upper layer');
        this.failureCount = 0;
    }
}
