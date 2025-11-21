
import { CognitiveScheduler } from '../../src/core/scheduler';
import { BusManager } from '../../src/core/bus';
import { AceLayerID, SouthboundType } from '../../src/types';

describe('CognitiveScheduler', () => {
    let bus: BusManager;
    let scheduler: CognitiveScheduler;

    beforeEach(() => {
        bus = new BusManager();
        scheduler = new CognitiveScheduler(bus, 100); // 100ms interval
    });

    afterEach(() => {
        scheduler.stop();
    });

    test('should emit heartbeat signal periodically', (done) => {
        let count = 0;

        bus.southbound.on(AceLayerID.GLOBAL_STRATEGY, (packet) => {
            if (packet.type === SouthboundType.CONTROL && packet.content === 'HEARTBEAT_REFLECTION') {
                count++;
                if (count >= 2) {
                    scheduler.stop();
                    done();
                }
            }
        });

        scheduler.start();
    }, 1000); // Timeout 1s
});
