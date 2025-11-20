/**
 * 简单的 LLM 实现
 * 用于测试，返回模拟的结构化响应
 */

import { BaseLLM } from 'ace-engine-core';

export class SimpleLLM implements BaseLLM {
    private taskCounter = 0;

    async generate(prompt: string): Promise<string> {
        this.taskCounter++;

        // 根据 Prompt 类型返回不同的模拟响应
        if (prompt.includes('You represent the company\'s best practices')) {
            // Generator Prompt
            return this.generateTaskResponse(prompt);
        } else if (prompt.includes('Analyze the following task trajectory')) {
            // Reflector Prompt
            return this.generateReflectionResponse(prompt);
        } else if (prompt.includes('Review the following insight')) {
            // Curator Prompt
            return this.generateCurationResponse(prompt);
        }

        return '{}';
    }

    async generateStructured<T>(prompt: string, _schema: unknown): Promise<T> {
        const response = await this.generate(prompt);
        try {
            // 尝试从 markdown 代码块中提取 JSON
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]) as T;
            }
            return JSON.parse(response) as T;
        } catch (error) {
            console.error('JSON 解析失败:', error);
            throw error;
        }
    }

    private generateTaskResponse(prompt: string): string {
        // 从 prompt 中提取任务描述
        const taskMatch = prompt.match(/Task: (.+)/);
        const task = taskMatch ? taskMatch[1] : '未知任务';

        return `
\`\`\`json
{
  "steps": [
    {
      "thought": "理解用户需求: ${task}",
      "action": "分析任务类型",
      "output": "任务类型已识别"
    },
    {
      "thought": "规划执行步骤",
      "action": "制定解决方案",
      "output": "方案已制定"
    },
    {
      "thought": "执行任务",
      "action": "生成代码/内容",
      "output": "任务完成"
    }
  ],
  "final_result": "已为您完成任务: ${task}。这是一个模拟响应，实际应用中会调用真实的 LLM。",
  "used_rule_ids": []
}
\`\`\`
        `;
    }

    private generateReflectionResponse(prompt: string): string {
        const insights = [
            '在编写代码时应该包含错误处理',
            '确保代码有适当的注释说明',
            '使用异步操作时应该添加 try-catch',
            '返回结果时应该包含类型说明',
            '遵循项目的代码风格规范',
        ];

        const randomInsight = insights[Math.floor(Math.random() * insights.length)];

        return `
\`\`\`json
{
  "outcome_analysis": "任务执行成功，用户获得了满意的结果",
  "blame_assignment": {
    "type": "missing_knowledge",
    "culprit_rule_id": null,
    "new_insight": "${randomInsight}"
  }
}
\`\`\`
        `;
    }

    private generateCurationResponse(prompt: string): string {
        // 随机决定是添加、更新还是忽略
        const decisions = ['ADD', 'IGNORE', 'UPDATE'];
        const decision = decisions[Math.floor(Math.random() * decisions.length)];

        if (decision === 'IGNORE') {
            return `
\`\`\`json
{
  "decision": "IGNORE",
  "target_rule_id": null,
  "reasoning": "这个见解与现有规则重复，暂不处理"
}
\`\`\`
            `;
        }

        if (decision === 'UPDATE') {
            return `
\`\`\`json
{
  "decision": "UPDATE",
  "target_rule_id": null,
  "reasoning": "更新现有规则的统计信息"
}
\`\`\`
            `;
        }

        // ADD
        const insightMatch = prompt.match(/"new_insight":\s*"([^"]+)"/);
        const insight = insightMatch ? insightMatch[1] : '新规则';

        return `
\`\`\`json
{
  "decision": "ADD",
  "target_rule_id": null,
  "new_content": "${insight}",
  "reasoning": "这是一条有价值的新规则，添加到知识库中"
}
\`\`\`
        `;
    }
}
