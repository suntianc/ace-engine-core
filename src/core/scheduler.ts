
import { BusManager } from './bus';
import { AceLayerID, SouthboundType } from '../types';
import crypto from 'crypto';

/**
 * 认知调度器
 * 只负责心跳机制，反思由基于惊奇度的触发器驱动
 */
export class CognitiveScheduler {
    private bus: BusManager;
    private intervalId: NodeJS.Timeout | null = null;
    private intervalMs: number;

    constructor(bus: BusManager, intervalMs: number = 1000) {
        this.bus = bus;
        this.intervalMs = intervalMs;
    }

    start() {
        if (this.intervalId) return;
        this.intervalId = setInterval(() => this.tick(), this.intervalMs);
        console.log('[CognitiveScheduler] Started (heartbeat only, reflection triggers disabled)');
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

        // Heartbeat only - 保持系统活跃并触发认知控制层检查
        // 反思现在由基于惊奇度的触发器驱动，不再使用定时触发
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
    }
}
