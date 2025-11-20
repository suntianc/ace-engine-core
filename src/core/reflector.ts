/**
 * Reflector - 反思器
 * @version 1.0.0
 */

import { BaseLLM, Trajectory, Insight } from '../types';
import { buildPrompt } from '../prompts/reflector';
import { ReflectorOutputSchema } from '../utils/schemas';
import { safeParseJSON, retry } from '../utils/helpers';

/**
 * Reflector 配置
 */
export interface ReflectorConfig {
    /** LLM 实例 */
    llm: BaseLLM;

    /** 是否启用重试 */
    enableRetry?: boolean;

    /** 最大重试次数 */
    maxRetries?: number;
}

/**
 * Reflector 类 - 负责反思任务执行
 */
export class Reflector {
    private llm: BaseLLM;
    private enableRetry: boolean;
    private maxRetries: number;

    constructor(config: ReflectorConfig) {
        this.llm = config.llm;
        this.enableRetry = config.enableRetry ?? true;
        this.maxRetries = config.maxRetries ?? 3;
    }

    /**
     * 分析轨迹并生成见解
     */
    async analyze(trajectory: Trajectory): Promise<Insight> {
        const analyzeTask = async (): Promise<Insight> => {
            // 构建提示词
            const prompt = buildPrompt(trajectory);

            // 调用 LLM
            const llmResponse = await this.llm.generate(prompt);

            // 解析 LLM 输出
            const parsed = safeParseJSON(llmResponse);

            // 验证 Schema
            const validated = ReflectorOutputSchema.parse(parsed);

            // 转换为 Insight 类型
            return {
                outcome_analysis: validated.outcome_analysis,
                blame_assignment: {
                    type: validated.blame_assignment.type,
                    culprit_rule_id: validated.blame_assignment.culprit_rule_id,
                    new_insight: validated.blame_assignment.new_insight,
                },
            };
        };

        // 如果启用重试，使用重试机制
        if (this.enableRetry) {
            return await retry(analyzeTask, {
                maxRetries: this.maxRetries,
                delayMs: 1000,
                onRetry: (error, attempt) => {
                    console.warn(`Reflector analysis failed (attempt ${attempt}):`, error.message);
                },
            });
        }

        return await analyzeTask();
    }
}
