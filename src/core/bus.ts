
import EventEmitter from 'eventemitter3';
import { z } from 'zod';
import {
    SouthboundPacket,
    NorthboundPacket,
    AceLayerID,
    SouthboundType,
    NorthboundType
} from '../types';
import { SecurityError } from '../utils/errors';

// Zod Schemas for Validation
export const SouthboundSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.number(),
    traceId: z.string(),
    sourceLayer: z.nativeEnum(AceLayerID),
    targetLayer: z.nativeEnum(AceLayerID),
    type: z.nativeEnum(SouthboundType),
    content: z.string(),
    parameters: z.record(z.any()).optional(),
});

export const NorthboundSchema = z.object({
    id: z.string().uuid(),
    timestamp: z.number(),
    traceId: z.string(),
    sourceLayer: z.nativeEnum(AceLayerID),
    targetLayer: z.nativeEnum(AceLayerID),
    type: z.nativeEnum(NorthboundType),
    summary: z.string(),
    data: z.any().optional(),
});


export type BusMiddleware<T> = (packet: T, next: () => Promise<void>) => Promise<void>;

export enum BusDirection {
    NORTHBOUND = 'NORTHBOUND',
    SOUTHBOUND = 'SOUTHBOUND',
}

class SecurityOverlay {
    private static readonly PROHIBITED_COMMANDS = [
        'rm -rf', 'mkfs', 'dd if=/dev/zero', ':(){:|:&};:', 'wget', 'curl', 'chmod 777'
    ];

    private seenPacketIds = new Set<string>();
    private static readonly MAX_TRACKED_IDS = 1000;

    async monitorSouthbound(packet: SouthboundPacket, next: () => Promise<void>) {
        // 1. Check for prohibited commands
        for (const cmd of SecurityOverlay.PROHIBITED_COMMANDS) {
            if (packet.content.includes(cmd)) {
                throw new SecurityError(`Prohibited command detected: ${cmd}`);
            }
        }

        // 2. Check for circular dependency / Dead Loop
        // We track recent packet IDs to prevent processing the same packet multiple times
        // This prevents infinite loops where the same instruction is repeatedly sent
        if (this.seenPacketIds.has(packet.id)) {
            const error = new SecurityError(`Circular dependency or duplicate packet detected: ${packet.id}`);
            console.error('[SecurityOverlay]', error.message);
            throw error;
        }
        this.seenPacketIds.add(packet.id);

        // Cleanup old IDs to prevent memory leak
        // Use LRU-style eviction: when we exceed the limit, remove oldest entries
        if (this.seenPacketIds.size > SecurityOverlay.MAX_TRACKED_IDS) {
            // Remove the oldest 10% of entries
            const idsToRemove = Array.from(this.seenPacketIds).slice(0, Math.floor(SecurityOverlay.MAX_TRACKED_IDS * 0.1));
            idsToRemove.forEach(id => this.seenPacketIds.delete(id));
        }

        await next();
    }

    async monitorNorthbound(packet: NorthboundPacket, next: () => Promise<void>) {
        // 1. Data Redaction (Simple example)
        if (packet.data && typeof packet.data === 'object') {
            this.redactObject(packet.data);
        }
        await next();
    }

    private redactObject(obj: any) {
        const SENSITIVE_KEYS = ['apikey', 'password', 'token', 'secret'];
        for (const key in obj) {
            if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
                obj[key] = '[REDACTED]';
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                this.redactObject(obj[key]);
            }
        }
    }
}

export class BusManager {
    public northbound: EventEmitter;
    public southbound: EventEmitter;

    private sbMiddlewares: BusMiddleware<SouthboundPacket>[] = [];
    private nbMiddlewares: BusMiddleware<NorthboundPacket>[] = [];
    private storage?: { logs?: { logDirective: (packet: SouthboundPacket) => Promise<void>; logTelemetry: (packet: NorthboundPacket) => Promise<void> } };
    private securityOverlay: SecurityOverlay;

    constructor(storage?: { logs?: { logDirective: (packet: SouthboundPacket) => Promise<void>; logTelemetry: (packet: NorthboundPacket) => Promise<void> } }) {
        this.northbound = new EventEmitter();
        this.southbound = new EventEmitter();
        this.storage = storage;
        this.securityOverlay = new SecurityOverlay();

        // Register Security Overlay by default as instance methods
        this.use(BusDirection.SOUTHBOUND, (packet, next) => this.securityOverlay.monitorSouthbound(packet, next));
        this.use(BusDirection.NORTHBOUND, (packet, next) => this.securityOverlay.monitorNorthbound(packet, next));
    }

    use(direction: BusDirection, middleware: BusMiddleware<any>) {
        if (direction === BusDirection.SOUTHBOUND) {
            this.sbMiddlewares.push(middleware);
        } else {
            this.nbMiddlewares.push(middleware);
        }
    }

    async publishSouthbound(packet: SouthboundPacket) {
        // 1. Validation
        SouthboundSchema.parse(packet);

        // 2. Middleware Execution
        let index = 0;
        const next = async () => {
            if (index < this.sbMiddlewares.length) {
                await this.sbMiddlewares[index++](packet, next);
            }
        };
        await next();

        // 3. Internal Logging (after middleware, before event dispatch)
        if (this.storage?.logs) {
            try {
                await this.storage.logs.logDirective(packet);
            } catch (error) {
                console.error('[BusManager] Failed to log directive:', error);
            }
        }

        // 4. Emit
        this.southbound.emit(packet.targetLayer, packet);
    }

    async publishNorthbound(packet: NorthboundPacket) {
        // 1. Validation
        NorthboundSchema.parse(packet);

        // 2. Middleware Execution
        let index = 0;
        const next = async () => {
            if (index < this.nbMiddlewares.length) {
                await this.nbMiddlewares[index++](packet, next);
            }
        };
        await next();

        // 3. Internal Logging (after middleware, before event dispatch)
        if (this.storage?.logs) {
            try {
                await this.storage.logs.logTelemetry(packet);
            } catch (error) {
                console.error('[BusManager] Failed to log telemetry:', error);
            }
        }

        // 4. Emit
        this.northbound.emit(packet.targetLayer, packet);
    }
}
