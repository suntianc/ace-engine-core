/**
 * ACE Engine Core - 基础使用示例
 *
 * 这个示例展示如何使用 ACE Engine Core SDK
 */

import { ChromaClient } from 'chromadb';
import { AceAgent } from '../src/agent';
import { ChromaAdapter } from '../src/adapters/chroma-adapter';
import { SQLiteAdapter } from '../src/adapters/sqlite-adapter';
import { BaseLLM } from '../src/types';

/**
 * 简单的 LLM Mock 实现 (实际项目中应替换为真实的 LLM)
 */
class MockLLM implements BaseLLM {
    async generate(prompt: string): Promise<string> {
        console.log('LLM Prompt:', prompt.substring(0, 200) + '...');

        // 模拟 JSON 响应
        return `
\`\`\`json
{
  "steps": [
    {
      "thought": "分析用户需求",
      "action": "理解任务",
      "output": "任务已理解"
    }
  ],
  "final_result": "这是一个示例响应",
  "used_rule_ids": []
}
\`\`\`
    `;
    }

    async generateStructured<T>(prompt: string, schema: unknown): Promise<T> {
        const response = await this.generate(prompt);
        return JSON.parse(response) as T;
    }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
    console.log('🚀 ACE Engine Core - 基础使用示例\n');

    // 1. 初始化存储适配器
    console.log('1. 初始化存储适配器...');

    const sqliteStore = new SQLiteAdapter('./data/ace_events.db');
    sqliteStore.init();

    const chromaClient = new ChromaClient({ path: 'http://localhost:8000' });
    const chromaStore = new ChromaAdapter(chromaClient, 'ace_playbook');
    await chromaStore.init();

    // 2. 创建 LLM 实例
    const llm = new MockLLM();

    // 3. 初始化 ACE Agent
    console.log('2. 初始化 ACE Agent...');

    const agent = new AceAgent({
        llm,
        vectorStore: chromaStore,
        trajectoryStore: sqliteStore,
        reflectionStrategy: 'always',
        retrievalLimit: 5,
    });

    // 4. 监听事件
    agent.on('status', (status) => {
        console.log(`   状态: ${status}`);
    });

    agent.on('reflected', (insight) => {
        console.log('   ✓ 反思完成:', insight.outcome_analysis);
    });

    agent.on('evolved', (deltas) => {
        console.log(`   ✓ 进化完成: ${deltas.length} 条更新`);
    });

    agent.on('error', (error) => {
        console.error('   ✗ 错误:', error.message);
    });

    // 5. 执行任务
    console.log('\n3. 执行任务...');

    try {
        const result = await agent.run('帮我写一个 Python 脚本查询天气');
        console.log('\n任务结果:', result);

        // 等待后台进化完成
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log('\n✅ 示例完成！');
    } catch (error) {
        console.error('任务执行失败:', error);
    } finally {
        agent.close();
    }
}

// 运行示例
main().catch(console.error);
