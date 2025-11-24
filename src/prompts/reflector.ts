/**
 * Reflector Prompt 模板
 * @version 1.0.0
 */

import { Trajectory } from '../types';

/**
 * 系统提示词
 */
export const SYSTEM_PROMPT = `你是一个深度反思专家，负责分析AI助手的任务执行轨迹。

你的目标是：
1. 分析任务成功或失败的根本原因
2. 识别是否存在问题规则（误导性规则）
3. 提取新的知识和见解
4. 判断问题类型（知识缺失、错误规则、幻觉、外部错误）

你必须客观、精确，不要过度归因。
`;

/**
 * 构建反思提示词
 */
export function buildPrompt(trajectory: Trajectory): string {
    const stepsText = trajectory.steps
        .map((step, i) => `**步骤 ${i + 1}:**\n- 思考: ${step.thought}\n- 动作: ${step.action}\n- 输出: ${step.output}`)
        .join('\n\n');

    return `${SYSTEM_PROMPT}

---

## 任务轨迹

**用户输入:** ${trajectory.user_input}

**执行过程:**
${stepsText}

**最终结果:** ${trajectory.final_result}

**任务结果:** ${trajectory.outcome}

**环境反馈:** ${trajectory.environment_feedback || '无'}

**引用的规则 ID:** ${trajectory.used_rule_ids.join(', ') || '无'}

---

请分析这次任务执行，并严格按照以下 JSON 格式输出：

\`\`\`json
{
  "outcome_analysis": "详细分析任务成功或失败的原因",
  "blame_assignment": {
    "type": "missing_knowledge | bad_rule | hallucination | external_error",
    "culprit_rule_id": "如果存在问题规则，填写规则ID，否则为null",
    "new_insight": "从这次任务中学到的新知识或规则"
  }
}
\`\`\`
`;
}
