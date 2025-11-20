/**
 * Generator 单元测试
 */

import { Generator } from '../src/core/generator';
import { BaseLLM, Rule } from '../src/types';
import { IVectorStore } from '../src/interfaces/store';

// Mock LLM
class MockLLM implements BaseLLM {
    async generate(_prompt: string): Promise<string> {
        return `
\`\`\`json
{
  "steps": [
    {
      "thought": "测试思考",
      "action": "测试动作",
      "output": "测试输出"
    }
  ],
  "final_result": "测试结果",
  "used_rule_ids": ["test-rule-1"]
}
\`\`\`
    `;
    }

    async generateStructured<T>(_prompt: string, _schema: unknown): Promise<T> {
        const response = await this.generate(_prompt);
        return JSON.parse(response) as T;
    }
}

// Mock Vector Store
class MockVectorStore implements IVectorStore {
    private rules: Map<string, Rule> = new Map();

    async search(_query: string, limit: number): Promise<Rule[]> {
        return Array.from(this.rules.values()).slice(0, limit);
    }

    async add(rules: Omit<Rule, 'score'>[]): Promise<void> {
        for (const rule of rules) {
            this.rules.set(rule.id, rule as Rule);
        }
    }

    async update(
        id: string,
        content?: string,
        metadata?: Partial<Rule['metadata']>
    ): Promise<void> {
        const rule = this.rules.get(id);
        if (!rule) return;

        if (content) {
            rule.content = content;
        }
        if (metadata) {
            rule.metadata = { ...rule.metadata, ...metadata };
        }
    }

    async delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            this.rules.delete(id);
        }
    }
}

describe('Generator', () => {
    let generator: Generator;
    let mockLLM: MockLLM;
    let mockVectorStore: MockVectorStore;

    beforeEach(() => {
        mockLLM = new MockLLM();
        mockVectorStore = new MockVectorStore();
        generator = new Generator({
            llm: mockLLM,
            vectorStore: mockVectorStore,
            retrievalLimit: 5,
        });
    });

    describe('retrieveContext', () => {
        it('应该检索相关规则', async () => {
            // 准备测试数据
            await mockVectorStore.add([
                {
                    id: 'test-rule-1',
                    content: '测试规则 1',
                    metadata: {
                        created_at: Date.now(),
                        last_used_at: Date.now(),
                        success_count: 0,
                        failure_count: 0,
                    },
                },
            ]);

            const rules = await generator.retrieveContext('测试查询');
            expect(rules).toHaveLength(1);
            expect(rules[0].id).toBe('test-rule-1');
        });
    });

    describe('execute', () => {
        it('应该成功执行任务并返回结果', async () => {
            const result = await generator.execute('测试任务', []);

            expect(result.result).toBe('测试结果');
            expect(result.trajectory).toBeDefined();
            expect(result.trajectory.user_input).toBe('测试任务');
            expect(result.trajectory.steps).toHaveLength(1);
            expect(result.trajectory.outcome).toBe('SUCCESS');
        });

        it('应该正确解析 LLM 输出', async () => {
            const result = await generator.execute('测试任务', []);

            expect(result.trajectory.steps[0]).toEqual({
                thought: '测试思考',
                action: '测试动作',
                output: '测试输出',
            });
            expect(result.trajectory.used_rule_ids).toEqual(['test-rule-1']);
        });
    });
});
