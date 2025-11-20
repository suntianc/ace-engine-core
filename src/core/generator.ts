/**
 * Generator - 任务执行器
 * @version 1.0.0
 */

import { BaseLLM, Rule, Trajectory } from '../types';
import { IVectorStore } from '../interfaces/store';
import { buildPrompt } from '../prompts/generator';
import { GeneratorOutputSchema, GeneratorOutput } from '../utils/schemas';
import { generateId, safeParseJSON } from '../utils/helpers';

/**
 * Generator 配置
 */
export interface GeneratorConfig {
    /** LLM 实例 */
    llm: BaseLLM;

    /** 向量存储 */
    vectorStore: IVectorStore;

    /** 检索规则数量 */
    retrievalLimit?: number;
}

/**
 * Generator 类 - 负责执行任务
 */
export class Generator {
    private llm: BaseLLM;
    private vectorStore: IVectorStore;
    private retrievalLimit: number;

    constructor(config: GeneratorConfig) {
        this.llm = config.llm;
        this.vectorStore = config.vectorStore;
        this.retrievalLimit = config.retrievalLimit || 5;
    }

    /**
     * 检索相关上下文
     */
    async retrieveContext(query: string): Promise<Rule[]> {
        return await this.vectorStore.search(query, this.retrievalLimit);
    }

    /**
     * 执行任务
     * @returns 结果和轨迹
     */
    async execute(
        userInput: string,
        context: Rule[]
    ): Promise<{ result: string; trajectory: Trajectory }> {
        const startTime = Date.now();
        const taskId = generateId();

        // 构建提示词
        const prompt = buildPrompt(userInput, context);

        // 调用 LLM
        const llmResponse = await this.llm.generate(prompt);

        // 解析 LLM 输出
        const parsed = safeParseJSON<GeneratorOutput>(llmResponse);

        // 验证 Schema
        const validated = GeneratorOutputSchema.parse(parsed);

        // 更新使用的规则的元数据
        await this.updateRuleUsage(validated.used_rule_ids);

        // 构建轨迹对象
        const trajectory: Trajectory = {
            task_id: taskId,
            user_input: userInput,
            steps: validated.steps,
            final_result: validated.final_result,
            environment_feedback: '', // 可以由外部补充
            outcome: 'SUCCESS', // 默认成功，可以由外部更新
            used_rule_ids: validated.used_rule_ids,
            timestamp: Date.now(),
            duration_ms: Date.now() - startTime,
            evolution_status: 'PENDING',
        };

        return {
            result: validated.final_result,
            trajectory,
        };
    }

    /**
     * 更新规则使用统计
     */
    private async updateRuleUsage(ruleIds: string[]): Promise<void> {
        const now = Date.now();

        for (const ruleId of ruleIds) {
            try {
                await this.vectorStore.update(ruleId, undefined, {
                    last_used_at: now,
                    success_count: undefined, // 暂时不更新计数，等待 Reflector 判断
                });
            } catch (error) {
                // 规则可能不存在，忽略错误
                console.warn(`Failed to update rule ${ruleId}:`, error);
            }
        }
    }
}
