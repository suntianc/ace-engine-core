/**
 * Generator Prompt 模板
 * @version 1.0.0
 */

import { Rule } from '../types';

/**
 * 系统提示词
 */
export const SYSTEM_PROMPT = `你是一个高性能的AI助手，代表公司的最佳实践和积累的知识。

你的任务是：
1. 严格遵循战术手册（Playbook）中的规则
2. 在执行任务时，显式引用相关规则（格式：(Ref: rule_xxx)）
3. 如果遇到规则冲突或缺失，优先使用常识判断
4. 清晰记录你的思考过程（Chain of Thought）

你必须以结构化的方式输出，包括：
- thought: 你的思考过程
- action: 你执行的动作
- output: 动作的结果
`;

/**
 * 构建上下文块
 */
export function buildContextBlock(rules: Rule[]): string {
    if (rules.length === 0) {
        return '**当前没有可用的战术规则。**\n';
    }

    let context = '## 战术手册 (Playbook)\n\n';
    context += '以下是你应该遵循的规则（按相关性排序）：\n\n';

    rules.forEach((rule, index) => {
        context += `${index + 1}. **[Rule ID: ${rule.id}]**\n`;
        context += `   ${rule.content}\n`;
        context += `   _使用次数: ${rule.metadata.success_count} 成功 / ${rule.metadata.failure_count} 失败_\n\n`;
    });

    return context;
}

/**
 * 构建完整提示词
 */
export function buildPrompt(userTask: string, rules: Rule[]): string {
    const contextBlock = buildContextBlock(rules);

    return `${SYSTEM_PROMPT}

${contextBlock}

---

## 用户任务

${userTask}

---

请严格按照以下 JSON 格式输出你的执行过程：

\`\`\`json
{
  "steps": [
    {
      "thought": "思考过程，包括引用的规则 (Ref: rule_xxx)",
      "action": "执行的动作",
      "output": "动作输出"
    }
  ],
  "final_result": "最终结果",
  "used_rule_ids": ["rule_xxx", "rule_yyy"]
}
\`\`\`
`;
}
