
import { BusManager } from './bus';
import { AceLayerID, SouthboundType } from '../types';
import crypto from 'crypto';

export class CognitiveScheduler {
    private bus: BusManager;
    private intervalId: NodeJS.Timeout | null = null;
    private intervalMs: number;
    private lastReflectionTime: number = 0;
    private reflectionIntervalMs: number;

    constructor(bus: BusManager, intervalMs: number = 1000, reflectionIntervalMs?: number) {
        this.bus = bus;
        this.intervalMs = intervalMs;
        this.reflectionIntervalMs = reflectionIntervalMs ?? 5 * 60 * 1000; // Default: 5 minutes
    }

    start() {
        if (this.intervalId) return;
        this.intervalId = setInterval(() => this.tick(), this.intervalMs);
        console.log('[CognitiveScheduler] Started');
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[CognitiveScheduler] Stopped');
        }
    }

    private async tick() {
        const now = Date.now();

        // 1. Heartbeat (Every tick/second)
        // Emitting a heartbeat to keep the system alive and trigger Cognitive Control checks
        await this.bus.publishSouthbound({
            id: crypto.randomUUID(),
            timestamp: now,
            traceId: crypto.randomUUID(),
            sourceLayer: AceLayerID.ASPIRATIONAL, // System-level trigger
            targetLayer: AceLayerID.COGNITIVE_CONTROL,
            type: SouthboundType.CONTROL,
            content: 'HEARTBEAT',
            parameters: {
                timestamp: now,
                cycleType: 'heartbeat'
            }
        });

        // 2. Reflection Cycle (Every 5 minutes)
        if (now - this.lastReflectionTime >= this.reflectionIntervalMs) {
            console.log('[CognitiveScheduler] Triggering Reflection Cycle');
            this.lastReflectionTime = now;

            // Reflection cycle is triggered by the system itself, not by any specific layer
            // Using ASPIRATIONAL as the source represents the highest-level system authority
            await this.bus.publishSouthbound({
                id: crypto.randomUUID(),
                timestamp: now,
                traceId: crypto.randomUUID(),
                sourceLayer: AceLayerID.ASPIRATIONAL, // System-level trigger from highest authority
                targetLayer: AceLayerID.GLOBAL_STRATEGY,
                type: SouthboundType.CONTROL,
                content: 'REFLECTION_CYCLE_START',
                parameters: {
                    reason: 'Periodic self-assessment',
                    cycleType: 'reflection'
                }
            });
        }
    }
}
