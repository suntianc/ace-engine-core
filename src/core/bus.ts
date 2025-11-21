
import EventEmitter from 'eventemitter3';
import { z } from 'zod';
import {
    SouthboundPacket,
    NorthboundPacket,
    AceLayerID,
    SouthboundType,
    NorthboundType
} from '../types';

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

export class SecurityOverlay {
    private static PROHIBITED_COMMANDS = [
        'rm -rf', 'mkfs', 'dd if=/dev/zero', ':(){:|:&};:', 'wget', 'curl', 'chmod 777'
    ];

    static async monitorSouthbound(packet: SouthboundPacket, next: () => Promise<void>) {
        // 1. Check for prohibited commands
        for (const cmd of SecurityOverlay.PROHIBITED_COMMANDS) {
            if (packet.content.includes(cmd)) {
                throw new Error(`Security Violation: Prohibited command detected: ${cmd}`);
            }
        }

        // 2. Check for circular dependency (simple ID check for now, can be expanded)
        // In a real scenario, we might check a trace history in the packet if available

        await next();
    }

    static async monitorNorthbound(packet: NorthboundPacket, next: () => Promise<void>) {
        // 1. Data Redaction (Simple example)
        if (packet.data && typeof packet.data === 'object') {
            SecurityOverlay.redactObject(packet.data);
        }
        await next();
    }

    private static redactObject(obj: any) {
        const SENSITIVE_KEYS = ['apikey', 'password', 'token', 'secret'];
        for (const key in obj) {
            if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
                obj[key] = '[REDACTED]';
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                SecurityOverlay.redactObject(obj[key]);
            }
        }
    }
}

export class BusManager {
    public northbound: EventEmitter;
    public southbound: EventEmitter;

    private sbMiddlewares: BusMiddleware<SouthboundPacket>[] = [];
    private nbMiddlewares: BusMiddleware<NorthboundPacket>[] = [];

    constructor() {
        this.northbound = new EventEmitter();
        this.southbound = new EventEmitter();

        // Register Security Overlay by default
        this.use(BusDirection.SOUTHBOUND, SecurityOverlay.monitorSouthbound);
        this.use(BusDirection.NORTHBOUND, SecurityOverlay.monitorNorthbound);
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

        // 3. Emit
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

        // 3. Emit
        this.northbound.emit(packet.targetLayer, packet);
    }
}
