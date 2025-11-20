/**
 * Curator Prompt 模板
 * @version 1.0.0
 */

import { Insight, Rule } from '../types';

/**
 * 系统提示词
 */
export const SYSTEM_PROMPT = `你是一个知识策展人，负责维护和更新战术手册（Playbook）。

你的职责是：
1. 评估新见解的价值和新颖性
2. 决定是否需要更新现有规则或添加新规则
3. 避免创建重复或冲突的规则
4. 保持规则库的简洁和高质量

决策选项：
- IGNORE: 忽略此见解（低价值或重复）
- UPDATE: 更新现有规则的元数据（增加计数器）
- MERGE: 修改现有规则内容（融合新知识）
- ADD: 添加全新规则

你必须谨慎决策，避免规则库膨胀。
`;

/**
 * 构建策展提示词
 */
export function buildPrompt(insight: Insight, similarRules: Rule[]): string {
    let rulesText = '**没有找到相似的现有规则。**\n';

    if (similarRules.length > 0) {
        rulesText = '**相似的现有规则：**\n\n';
        similarRules.forEach((rule, i) => {
            rulesText += `${i + 1}. **[${rule.id}]** (相似度: ${((rule.score || 0) * 100).toFixed(1)}%)\n`;
            rulesText += `   内容: ${rule.content}\n`;
            rulesText += `   统计: ${rule.metadata.success_count} 成功 / ${rule.metadata.failure_count} 失败\n\n`;
        });
    }

    return `${SYSTEM_PROMPT}

---

## 新见解

**来源分析:** ${insight.outcome_analysis}

**问题类型:** ${insight.blame_assignment.type}

**问题规则 ID:** ${insight.blame_assignment.culprit_rule_id || '无'}

**新知识:** ${insight.blame_assignment.new_insight}

---

${rulesText}

---

请决定如何处理这个新见解，并以以下 JSON 格式输出：

\`\`\`json
{
  "decision": "IGNORE | UPDATE | MERGE | ADD",
  "target_rule_id": "如果是UPDATE或MERGE，填写目标规则ID，否则为null",
  "new_content": "如果是ADD或MERGE，填写新的或更新后的规则内容",
  "reasoning": "你的决策理由"
}
\`\`\`
`;
}
