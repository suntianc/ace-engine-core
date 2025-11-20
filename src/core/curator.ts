/**
 * Curator - 策展器
 * @version 1.0.0
 */

import { BaseLLM, Insight, Rule, Delta } from '../types';
import { IVectorStore, ITrajectoryStore, IAnalysisEngine } from '../interfaces/store';
import { buildPrompt } from '../prompts/curator';
import { CuratorOutputSchema } from '../utils/schemas';
import { safeParseJSON, generateId } from '../utils/helpers';

/**
 * Curator 配置
 */
export interface CuratorConfig {
    /** LLM 实例 */
    llm: BaseLLM;

    /** 向量存储 */
    vectorStore: IVectorStore;

    /** 轨迹存储 */
    trajectoryStore: ITrajectoryStore;

    /** 分析引擎 (DuckDB) */
    analysisEngine: IAnalysisEngine;

    /** 相似度搜索数量 */
    similarityLimit?: number;

    /** 相似度阈值 (0-1) */
    similarityThreshold?: number;
}

/**
 * Curator 类 - 负责策展和更新规则库
 */
export class Curator {
    private llm: BaseLLM;
    private vectorStore: IVectorStore;
    private trajectoryStore: ITrajectoryStore;
    private analysisEngine: IAnalysisEngine;
    private similarityLimit: number;
    private similarityThreshold: number;

    constructor(config: CuratorConfig) {
        this.llm = config.llm;
        this.vectorStore = config.vectorStore;
        this.trajectoryStore = config.trajectoryStore;
        this.analysisEngine = config.analysisEngine;
        this.similarityLimit = config.similarityLimit || 3;
        this.similarityThreshold = config.similarityThreshold || 0.85;
    }

    /**
     * 处理见解并生成 Delta
     */
    async processInsight(insight: Insight, _taskId: string): Promise<Delta[]> {
        // 1. 防抖检查：检查最近 24 小时是否已有类似的更新
        const isDuplicate = await this.checkDebounce(insight);
        if (isDuplicate) {
            console.log(`[Curator] Insight suppressed by debounce logic: ${insight.blame_assignment.new_insight.substring(0, 50)}...`);
            return [];
        }

        // 2. 搜索相似规则
        const similarRules = await this.findSimilarRules(insight.blame_assignment.new_insight);

        // 3. 构建提示词
        const prompt = buildPrompt(insight, similarRules);

        // 4. 调用 LLM 决策
        const llmResponse = await this.llm.generate(prompt);

        // 5. 解析输出
        const parsed = safeParseJSON(llmResponse);
        const validated = CuratorOutputSchema.parse(parsed);

        // 6. 根据决策生成 Delta
        const deltas: Delta[] = [];

        switch (validated.decision) {
            case 'IGNORE':
                // 不生成 Delta
                break;

            case 'UPDATE':
                if (validated.target_rule_id) {
                    deltas.push({
                        type: 'UPDATE',
                        rule_id: validated.target_rule_id,
                        reasoning: validated.reasoning,
                        change_payload: {
                            increment_success: insight.outcome_analysis.includes('成功'),
                        },
                    });
                }
                break;

            case 'MERGE':
                if (validated.target_rule_id && validated.new_content) {
                    deltas.push({
                        type: 'UPDATE',
                        rule_id: validated.target_rule_id,
                        content: validated.new_content,
                        reasoning: validated.reasoning,
                        change_payload: {
                            merged_insight: insight.blame_assignment.new_insight,
                        },
                    });
                }
                break;

            case 'ADD':
                if (validated.new_content) {
                    deltas.push({
                        type: 'ADD',
                        content: validated.new_content,
                        reasoning: validated.reasoning,
                        change_payload: {
                            source_insight: insight.blame_assignment.new_insight,
                        },
                    });
                }
                break;
        }

        return deltas;
    }

    /**
     * 应用 Delta 更新
     */
    async applyDeltas(deltas: Delta[], taskId: string): Promise<void> {
        const now = Date.now();

        for (const delta of deltas) {
            switch (delta.type) {
                case 'ADD':
                    if (delta.content) {
                        const ruleId = generateId();
                        await this.vectorStore.add([
                            {
                                id: ruleId,
                                content: delta.content,
                                metadata: {
                                    created_at: now,
                                    last_used_at: now,
                                    success_count: 0,
                                    failure_count: 0,
                                    source_task_id: taskId,
                                },
                            },
                        ]);

                        // 记录日志
                        this.trajectoryStore.logDelta({
                            rule_id: ruleId,
                            action_type: 'ADD',
                            reasoning: delta.reasoning,
                            change_payload: delta.change_payload || {},
                            triggered_by_task_id: taskId,
                            timestamp: now,
                        });
                    }
                    break;

                case 'UPDATE':
                    if (delta.rule_id) {
                        const updates: Partial<Rule['metadata']> = {};

                        if (delta.content) {
                            await this.vectorStore.update(delta.rule_id, delta.content);
                        }

                        if (delta.change_payload?.increment_success) {
                            // 这需要先获取当前值，然后增加
                            // 简化处理：只更新时间戳
                            updates.last_used_at = now;
                        }

                        if (Object.keys(updates).length > 0) {
                            await this.vectorStore.update(delta.rule_id, undefined, updates);
                        }

                        // 记录日志
                        this.trajectoryStore.logDelta({
                            rule_id: delta.rule_id,
                            action_type: 'UPDATE',
                            reasoning: delta.reasoning,
                            change_payload: delta.change_payload || {},
                            triggered_by_task_id: taskId,
                            timestamp: now,
                        });
                    }
                    break;

                case 'DELETE':
                    if (delta.rule_id) {
                        await this.vectorStore.delete([delta.rule_id]);

                        // 记录日志
                        this.trajectoryStore.logDelta({
                            rule_id: delta.rule_id,
                            action_type: 'DELETE',
                            reasoning: delta.reasoning,
                            change_payload: delta.change_payload || {},
                            triggered_by_task_id: taskId,
                            timestamp: now,
                        });
                    }
                    break;
            }
        }
    }

    /**
     * 查找相似规则
     */
    private async findSimilarRules(query: string): Promise<Rule[]> {
        const results = await this.vectorStore.search(query, this.similarityLimit);

        // 过滤低于阈值的结果
        return results.filter((rule) => (rule.score || 0) >= this.similarityThreshold);
    }

    /**
     * 防抖检查：查询 DuckDB 检查最近 24 小时是否有相似的更新
     */
    private async checkDebounce(insight: Insight): Promise<boolean> {
        try {
            // 查询最近 24 小时的 Delta Logs
            // 注意：这里假设 storage 是挂载的别名
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

            // 我们查找是否有 change_payload 中包含相似 insight 的记录
            // 由于 DuckDB JSON 查询比较复杂，这里简化为查询最近的记录然后在内存中比对
            // 或者如果 change_payload 存的是 JSON 字符串，可以用 LIKE

            const query = `
                SELECT change_payload 
                FROM storage.delta_logs 
                WHERE timestamp > ? 
                ORDER BY timestamp DESC
            `;

            const recentDeltas = await this.analysisEngine.query<{ change_payload: string }>(query, [oneDayAgo]);

            const newInsightText = insight.blame_assignment.new_insight;

            for (const row of recentDeltas) {
                try {
                    const payload = typeof row.change_payload === 'string'
                        ? JSON.parse(row.change_payload)
                        : row.change_payload;

                    // 检查 source_insight 或 merged_insight
                    const previousInsight = payload.source_insight || payload.merged_insight;

                    if (previousInsight && typeof previousInsight === 'string') {
                        // 简单的字符串包含或相似度检查
                        // 这里使用简单的包含检查作为防抖
                        if (previousInsight === newInsightText || previousInsight.includes(newInsightText) || newInsightText.includes(previousInsight)) {
                            return true;
                        }
                    }
                } catch (e) {
                    // 忽略解析错误
                }
            }

            return false;
        } catch (error) {
            console.error('[Curator] Debounce check failed:', error);
            return false; // 失败时默认不防抖，保证安全
        }
    }

    /**
     * 淘汰策略：清理长期未使用的规则
     * @param daysUnused 未使用天数阈值，默认 30 天
     */
    async runElimination(daysUnused: number = 30): Promise<number> {
        try {
            const cutoffTime = Date.now() - daysUnused * 24 * 60 * 60 * 1000;

            // 1. 从 DuckDB 查询长期未使用的规则
            // 我们需要结合 delta_logs (创建时间) 和 trajectories (使用时间)
            // 但目前 metadata 中有 last_used_at，Chroma 应该维护了这个状态
            // 不过设计文档建议用 DuckDB 统计

            // 方案：查询 delta_logs 找出所有规则，然后排除掉最近在 trajectories 中使用的规则

            // 找出最近活跃的规则 ID
            // trajectories.used_rule_ids 是 JSON 数组
            // DuckDB 可以展开 JSON 数组

            // 假设 trajectories 表有 used_rule_ids 字段
            const activeRulesQuery = `
                SELECT DISTINCT unnest(from_json(used_rule_ids, '["VARCHAR"]')) as rule_id
                FROM storage.trajectories
                WHERE timestamp > ?
            `;

            // 注意：DuckDB 的 JSON 处理可能需要特定扩展或语法，这里使用通用假设
            // 如果 from_json 不可用，可能需要调整
            // 替代方案：如果 metadata 在 Chroma 中维护得当，可以直接遍历 Chroma (但 Chroma API 不支持按 metadata 范围删除)

            // 让我们尝试用 DuckDB 查询 delta_logs 来获取所有规则，并结合 trajectories
            // 简化策略：
            // 1. 获取所有已知规则 ID (从 delta_logs ADD 操作)
            // 2. 获取最近活跃规则 ID
            // 3. 差集即为待删除规则

            const allRulesQuery = `
                SELECT DISTINCT rule_id 
                FROM storage.delta_logs 
                WHERE action_type = 'ADD'
            `;

            const allRules = await this.analysisEngine.query<{ rule_id: string }>(allRulesQuery);
            const activeRules = await this.analysisEngine.query<{ rule_id: string }>(activeRulesQuery, [cutoffTime]);

            const activeSet = new Set(activeRules.map(r => r.rule_id));
            const candidates = allRules.filter(r => !activeSet.has(r.rule_id));

            if (candidates.length === 0) {
                return 0;
            }

            const idsToDelete = candidates.map(r => r.rule_id);

            // 2. 执行删除
            await this.vectorStore.delete(idsToDelete);

            // 3. 记录日志
            const now = Date.now();
            for (const id of idsToDelete) {
                this.trajectoryStore.logDelta({
                    rule_id: id,
                    action_type: 'DELETE',
                    reasoning: `Elimination Strategy: Unused for ${daysUnused} days`,
                    change_payload: {},
                    triggered_by_task_id: 'SYSTEM_MAINTENANCE',
                    timestamp: now
                });
            }

            return idsToDelete.length;

        } catch (error) {
            console.error('[Curator] Elimination strategy failed:', error);
            return 0;
        }
    }
}
