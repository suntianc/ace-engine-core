/**
 * ACE Engine Core - 完整演示 Agent
 * 包含 DuckDB 分析引擎集成和维护任务演示
 */

import { ChromaClient } from 'chromadb';
import { AceAgent } from '../src/agent';
import { ChromaAdapter } from '../src/adapters/chroma-adapter';
import { SQLiteAdapter } from '../src/adapters/sqlite-adapter';
import { DuckDBAdapter } from '../src/adapters/duckdb-adapter';
import { BaseLLM } from '../src/types';

/**
 * 模拟 LLM
 * 针对不同类型的 Prompt 返回不同的模拟响应
 */
class DemoLLM implements BaseLLM {
    async generate(prompt: string): Promise<string> {
        // 简单的 Prompt 路由逻辑
        if (prompt.includes('You represent the company\'s best practices')) {
            // Generator 响应
            return JSON.stringify({
                steps: [
                    {
                        thought: "用户想要查询天气",
                        action: "调用天气 API",
                        output: "API 调用成功"
                    }
                ],
                final_result: "北京今天晴天，气温 25 度",
                used_rule_ids: []
            });
        } else if (prompt.includes('Analyze the following task trajectory')) {
            // Reflector 响应
            return JSON.stringify({
                outcome_analysis: "任务执行成功",
                blame_assignment: {
                    type: "missing_knowledge",
                    culprit_rule_id: null,
                    new_insight: "查询天气时应该默认提供温度单位"
                }
            });
        } else if (prompt.includes('Review the following insight')) {
            // Curator 响应
            return JSON.stringify({
                decision: "ADD",
                new_content: "查询天气时必须明确温度单位 (摄氏度/华氏度)",
                reasoning: "这是一个有价值的新规则，可以避免歧义",
                target_rule_id: null
            });
        }

        return "{}";
    }

    async generateStructured<T>(prompt: string, _schema: unknown): Promise<T> {
        const response = await this.generate(prompt);
        try {
            return JSON.parse(response) as T;
        } catch (e) {
            console.error('JSON Parse Error:', e);
            return {} as T;
        }
    }
}

async function main() {
    console.log('🤖 ACE Demo Agent 启动中...\n');

    // 1. 初始化存储层
    const sqliteStore = new SQLiteAdapter('./data/demo_agent.db');
    sqliteStore.init();
    console.log('✅ SQLite 初始化完成');

    // 注意：这里假设本地有 ChromaDB 运行，如果没有，ChromaAdapter 可能会报错
    // 为了演示方便，我们这里应该 catch 错误或者假设环境已就绪
    // 如果没有 Chroma，可以考虑实现一个 MockVectorStore 用于纯本地演示
    // 但为了"真实"测试 SDK，我们保留 ChromaAdapter
    const chromaClient = new ChromaClient({ path: 'http://localhost:8000' });
    const chromaStore = new ChromaAdapter(chromaClient, 'demo_playbook');
    // await chromaStore.init(); // Chroma 可能需要连接
    console.log('✅ Chroma Adapter 就绪 (请确保 Docker 运行了 ChromaDB)');

    const duckdbAnalysis = new DuckDBAdapter();
    await duckdbAnalysis.connect(sqliteStore.getDbPath());
    console.log('✅ DuckDB 分析引擎挂载完成');

    // 2. 初始化 Agent
    const agent = new AceAgent({
        llm: new DemoLLM(),
        vectorStore: chromaStore,
        trajectoryStore: sqliteStore,
        analysisEngine: duckdbAnalysis,
        reflectionStrategy: 'always',
        samplingRate: 1.0
    });

    // 3. 注册事件监听
    agent.on('status', (status) => console.log(`[状态] ${status}`));
    agent.on('reflected', (insight) => console.log(`[反思] ${insight.outcome_analysis}`));
    agent.on('evolved', (deltas) => {
        console.log(`[进化] 生成了 ${deltas.length} 条更新:`);
        deltas.forEach(d => console.log(`  - ${d.type}: ${d.reasoning}`));
    });
    agent.on('error', (err) => console.error(`[错误] ${err.message}`));

    // 4. 运行任务
    console.log('\nTesting Task Execution...');
    const result = await agent.run('查询北京天气');
    console.log(`Task Result: ${result}\n`);

    // 等待异步进化完成
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 5. 运行维护任务
    console.log('\nRunning Maintenance Task...');
    const deletedCount = await agent.runMaintenance(30);
    console.log(`Maintenance completed. Deleted ${deletedCount} unused rules.`);

    // 6. 清理
    await agent.close();
    console.log('\n👋 Demo Agent 已关闭');
}

main().catch(console.error);
