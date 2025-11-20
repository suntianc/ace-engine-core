/**
 * 遗忘机制脚本 - 清理长期未使用的规则
 */

import { IAnalysisEngine } from '../interfaces/store';
import { IVectorStore } from '../interfaces/store';

/**
 * 遗忘机制配置
 */
export interface ForgetConfig {
    /** 未使用天数阈值 */
    unusedDaysThreshold: number;

    /** 是否执行删除（false 时仅返回待删除规则） */
    dryRun: boolean;
}

/**
 * 执行遗忘机制
 */
export async function forgetUnusedRules(
    analysisEngine: IAnalysisEngine,
    vectorStore: IVectorStore,
    config: ForgetConfig
): Promise<string[]> {
    const thresholdTimestamp = Date.now() - config.unusedDaysThreshold * 24 * 60 * 60 * 1000;

    // 查询长期未使用的规则
    const query = `
    SELECT DISTINCT rule_id
    FROM storage.delta_logs
    WHERE rule_id IS NOT NULL
    GROUP BY rule_id
    HAVING MAX(timestamp) < ?
  `;

    const results = await analysisEngine.query<{ rule_id: string }>(query, [thresholdTimestamp]);
    const ruleIdsToDelete = results.map((r: { rule_id: string }) => r.rule_id);

    console.log(`发现 ${ruleIdsToDelete.length} 条长期未使用的规则`);

    if (!config.dryRun && ruleIdsToDelete.length > 0) {
        await vectorStore.delete(ruleIdsToDelete);
        console.log(`已删除 ${ruleIdsToDelete.length} 条规则`);
    } else if (config.dryRun) {
        console.log('Dry run 模式，未执行删除操作');
        console.log('待删除规则:', ruleIdsToDelete);
    }

    return ruleIdsToDelete;
}

/**
 * 示例使用
 */
export async function runForgetScript(
    analysisEngine: IAnalysisEngine,
    vectorStore: IVectorStore
): Promise<void> {
    console.log('🧹 开始执行遗忘机制...\n');

    const config: ForgetConfig = {
        unusedDaysThreshold: 30, // 30 天未使用
        dryRun: true, // 先执行 dry run
    };

    await forgetUnusedRules(analysisEngine, vectorStore, config);

    console.log('\n✅ 遗忘机制执行完成');
}
