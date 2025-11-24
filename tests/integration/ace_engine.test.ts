
import { AceEngine } from '../../src/ace_engine';
import { AceEngineConfig } from '../../src/types';

// Mock dependencies
const mockLLM = {
    generate: jest.fn().mockResolvedValue('Mock Response'),
    generateStructured: jest.fn().mockResolvedValue({})
};

const config: AceEngineConfig = {
    agentId: 'test-agent',
    storage: {
        mode: 'composite',
        sqlitePath: ':memory:',
        logsPath: ':memory:'
    },
    cache: {
        type: 'memory'
    },
    memory: {
        provider: 'chroma',
        endpoint: 'http://localhost:8000',
        collectionPrefix: 'test'
    },
    llm: {
        driver: mockLLM,
        modelMap: {}
    }
};

describe('AceEngine Integration', () => {
    let engine: AceEngine;

    beforeEach(() => {
        engine = new AceEngine(config);
    });

    afterEach(async () => {
        await engine.stop();
    });

    test('should initialize all layers', () => {
        expect(engine.bus).toBeDefined();
        expect(engine.storage).toBeDefined();
        // Accessing private layers via any cast for testing
        const layers = (engine as any).layers;
        expect(layers).toHaveLength(6);
    });

    test('should start and stop successfully', async () => {
        // Mock storage connections to avoid actual DB calls failing in test env without services
        (engine.storage.chroma as any).init = jest.fn().mockResolvedValue(undefined);

        await engine.start();
        // If no error thrown, pass
        expect(true).toBe(true);
    });
});
