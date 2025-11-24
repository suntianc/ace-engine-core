import { describe, test, beforeEach, expect } from '@jest/globals';
import * as crypto from 'crypto';

import { BusManager } from '../../src/core/bus';
import { AceLayerID, SouthboundType, NorthboundType } from '../../src/types';

describe('BusManager & SecurityOverlay', () => {
    let bus: BusManager;

    beforeEach(() => {
        bus = new BusManager();
    });

    test('should block prohibited commands in Southbound', async () => {
        const packet = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            traceId: 'test-trace',
            sourceLayer: AceLayerID.EXECUTIVE_FUNCTION,
            targetLayer: AceLayerID.TASK_PROSECUTION,
            type: SouthboundType.INSTRUCTION,
            content: 'Please run rm -rf /',
        };

        await expect(bus.publishSouthbound(packet)).rejects.toThrow('Prohibited command');
    });

    test('should redact sensitive data in Northbound', async () => {
        const packet = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            traceId: 'test-trace',
            sourceLayer: AceLayerID.TASK_PROSECUTION,
            targetLayer: AceLayerID.COGNITIVE_CONTROL,
            type: NorthboundType.RESULT,
            summary: 'Operation complete',
            data: {
                apiKey: '12345-secret',
                publicInfo: 'visible'
            }
        };

        let receivedData: any;
        bus.northbound.on(AceLayerID.COGNITIVE_CONTROL, (p) => {
            receivedData = p.data;
        });

        await bus.publishNorthbound(packet);

        expect(receivedData.apiKey).toBe('[REDACTED]');
        expect(receivedData.publicInfo).toBe('visible');
    });
});
