/**
 * 测试 Agent - 主程序
 * 演示 ACE Engine Core SDK 的完整使用流程
 */

import { ChromaClient } from 'chromadb';
import { AceAgent } from 'ace-engine-core';
import { ChromaAdapter, SQLiteAdapter, DuckDBAdapter } from 'ace-engine-core';
import { SimpleLLM } from './llm';

async function main() {
    console.log('🤖 ACE Test Agent 启动中...\n');

    // 1. 初始化存储适配器
    console.log('📦 初始化存储层...');

    const sqliteStore = new SQLiteAdapter('./data/ace_test.db');
    sqliteStore.init();
    console.log('  ✅ SQLite 初始化完成');

    const chromaClient = new ChromaClient({ path: 'http://localhost:8000' });
    const chromaStore = new ChromaAdapter(chromaClient, 'test_playbook');
    try {
        await chromaStore.init();
        console.log('  ✅ ChromaDB 连接成功');
    } catch (error) {
        console.error('  ❌ ChromaDB 连接失败，请确保 ChromaDB 服务已启动');
        console.error('     运行命令: docker run -p 8000:8000 chromadb/chroma');
        process.exit(1);
    }

    const duckdbAnalysis = new DuckDBAdapter();
    await duckdbAnalysis.connect(sqliteStore.getDbPath());
    console.log('  ✅ DuckDB 分析引擎挂载完成\n');

    // 2. 初始化 LLM
    console.log('🧠 初始化 LLM...');
    const llm = new SimpleLLM();
    console.log('  ✅ LLM 就绪\n');

    // 3. 创建 ACE Agent
    console.log('⚙️  创建 ACE Agent...');
    const agent = new AceAgent({
        llm,
        vectorStore: chromaStore,
        trajectoryStore: sqliteStore,
        analysisEngine: duckdbAnalysis,
        reflectionStrategy: 'always',
        retrievalLimit: 3,
    });
    console.log('  ✅ Agent 创建完成\n');

    // 4. 注册事件监听
    agent.on('status', (status) => {
        console.log(`[状态] ${status}`);
    });

    agent.on('reflected', (insight) => {
        console.log(`[反思] ${insight.outcome_analysis}`);
        console.log(`       新见解: ${insight.blame_assignment.new_insight}`);
    });

    agent.on('evolved', (deltas) => {
        console.log(`[进化] 生成 ${deltas.length} 条更新:`);
        deltas.forEach((d) => {
            console.log(`  - ${d.type}: ${d.reasoning}`);
        });
    });

    agent.on('error', (error) => {
        console.error(`[错误] ${error.message}`);
    });

    // 5. 执行测试任务
    console.log('🚀 执行测试任务...\n');

    const tasks = [
        '帮我写一个 Python 脚本查询天气',
        '编写一个 Node.js HTTP 服务器',
        '创建一个 React 组件显示用户列表',
    ];

    for (let i = 0; i < tasks.length; i++) {
        console.log(`\n📝 任务 ${i + 1}/${tasks.length}: ${tasks[i]}`);
        console.log('─'.repeat(60));

        try {
            const result = await agent.run(tasks[i]);
            console.log(`\n✅ 结果:\n${result}\n`);

            // 等待异步进化完成
            await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`❌ 任务执行失败:`, error);
        }
    }

    // 6. 执行维护任务
    console.log('\n🧹 执行维护任务...');
    const deletedCount = await agent.runMaintenance(30);
    console.log(`  清理了 ${deletedCount} 条长期未使用的规则\n`);

    // 7. 关闭 Agent
    await agent.close();
    console.log('👋 Test Agent 已关闭\n');
}

// 错误处理
main().catch((error) => {
    console.error('程序执行失败:', error);
    process.exit(1);
});
