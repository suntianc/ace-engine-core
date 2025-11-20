/**
 * Zod Schema 定义 - LLM 输出验证
 * @version 1.0.0
 */

import { z } from 'zod';

/**
 * Generator 输出 Schema
 */
export const GeneratorOutputSchema = z.object({
    steps: z.array(
        z.object({
            thought: z.string().describe('思考过程'),
            action: z.string().describe('执行的动作'),
            output: z.string().describe('动作输出'),
        })
    ),
    final_result: z.string().describe('最终结果'),
    used_rule_ids: z.array(z.string()).describe('使用的规则ID列表'),
});

export type GeneratorOutput = z.infer<typeof GeneratorOutputSchema>;

/**
 * Reflector 输出 Schema
 */
export const ReflectorOutputSchema = z.object({
    outcome_analysis: z.string().describe('结果分析'),
    blame_assignment: z.object({
        type: z
            .enum(['missing_knowledge', 'bad_rule', 'hallucination', 'external_error'])
            .describe('问题类型'),
        culprit_rule_id: z.string().nullable().describe('问题规则ID'),
        new_insight: z.string().describe('新见解'),
    }),
});

export type ReflectorOutput = z.infer<typeof ReflectorOutputSchema>;

/**
 * Curator 输出 Schema
 */
export const CuratorOutputSchema = z.object({
    decision: z.enum(['IGNORE', 'UPDATE', 'MERGE', 'ADD']).describe('决策类型'),
    target_rule_id: z.string().nullable().describe('目标规则ID'),
    new_content: z.string().optional().describe('新内容'),
    reasoning: z.string().describe('决策理由'),
});

export type CuratorOutput = z.infer<typeof CuratorOutputSchema>;
