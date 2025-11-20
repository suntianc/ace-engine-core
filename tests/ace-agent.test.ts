/**
 * AceAgent 单元测试
 */

import { AceAgent } from '../src/agent';
import { InMemoryVectorStore, InMemoryTransactionStore } from './mocks/store';
import { MockLLM } from './mocks/llm';
import { MockAnalysisEngine } from './mocks/analysis-engine';

describe('AceAgent', () => {
    let agent: AceAgent;
    let mockLLM: MockLLM;
    let mockVectorStore: InMemoryVectorStore;
    let mockTransactionStore: InMemoryTransactionStore;
    let mockAnalysisEngine: MockAnalysisEngine;

    beforeEach(() => {
        mockLLM = new MockLLM();
        mockVectorStore = new InMemoryVectorStore();
        mockTransactionStore = new InMemoryTransactionStore();
        mockAnalysisEngine = new MockAnalysisEngine();

        agent = new AceAgent({
            llm: mockLLM,
            vectorStore: mockVectorStore,
            trajectoryStore: mockTransactionStore,
            analysisEngine: mockAnalysisEngine,
            reflectionStrategy: 'always',
        });
    });

    afterEach(async () => {
        await agent.close();
    });

    describe('runMaintenance', () => {
        it('应该调用 curator.runElimination', async () => {
            // 模拟 curator.runElimination 的行为
            // 由于 curator 是私有属性，我们无法直接 spyOn
            // 但我们可以通过观察副作用（如 emit status）来验证

            let statusEmitted = false;
            agent.on('status', (status) => {
                if (status === 'maintenance') {
                    statusEmitted = true;
                }
            });

            // 连接 mock analysis engine
            await mockAnalysisEngine.connect(':memory:');

            // 设置 mock 数据以避免错误
            mockAnalysisEngine.setMockData('delta_logs', []);
            mockAnalysisEngine.setMockData('trajectories', []);

            const count = await agent.runMaintenance(30);

            expect(statusEmitted).toBe(true);
            expect(count).toBeGreaterThanOrEqual(0);
        });
    });
});
