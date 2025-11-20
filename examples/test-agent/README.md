# ACE Test Agent

ACE Engine Core SDK 的测试 Agent 项目，用于验证 SDK 的完整功能。

## 前置条件

1. **ChromaDB 服务**

需要在本地运行 ChromaDB 服务。使用 Docker 快速启动：

```bash
docker run -p 8000:8000 chromadb/chroma
```

2. **Node.js 环境**

确保已安装 Node.js 18+ 和 npm。

## 安装依赖

```bash
npm install
```

## 项目结构

```
test-agent/
├── src/
│   ├── index.ts    # 主程序
│   └── llm.ts      # 简单的 LLM 实现（用于测试）
├── data/           # SQLite 数据库文件（自动生成）
├── package.json
├── tsconfig.json
└── README.md
```

## 运行

### 开发模式（自动重启）

```bash
npm run dev
```

### 单次运行

```bash
npm start
```

### 编译后运行

```bash
npm run build
node dist/index.js
```

## 功能演示

此测试 Agent 演示了以下功能：

1. **存储层初始化**
   - SQLite 事务存储（WAL 模式）
   - ChromaDB 向量存储
   - DuckDB 分析引擎

2. **任务执行**
   - Generator：检索相关规则并生成响应
   - 轨迹记录：保存执行过程到 SQLite

3. **异步进化**
   - Reflector：分析任务执行结果
   - Curator：决策是否更新规则库
   - 防抖逻辑：避免重复更新

4. **维护任务**
   - 淘汰策略：自动清理长期未使用的规则

## 事件监听

Agent 会发出以下事件：

- `status`: 状态更新（reflecting, curating, maintenance）
- `reflected`: 反思完成
- `evolved`: 规则库更新完成
- `error`: 错误发生

## 数据持久化

- SQLite 数据库：`./data/ace_test.db`
- ChromaDB Collection：`test_playbook`

## 注意事项

1. **ChromaDB 连接**：确保 ChromaDB 服务在 `http://localhost:8000` 运行
2. **数据清理**：如需重置，删除 `./data` 目录即可
3. **LLM 替换**：实际使用时，将 `src/llm.ts` 替换为真实的 LLM 实现

## 真实 LLM 集成示例

如果要集成真实的 LLM（如 OpenAI、Anthropic），修改 `src/llm.ts`：

```typescript
import { BaseLLM } from 'ace-engine-core';
import OpenAI from 'openai';

export class RealLLM implements BaseLLM {
    private client: OpenAI;

    constructor(apiKey: string) {
        this.client = new OpenAI({ apiKey });
    }

    async generate(prompt: string): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: prompt }],
        });
        return response.choices[0].message.content || '';
    }

    async generateStructured<T>(prompt: string, schema: unknown): Promise<T> {
        const response = await this.generate(prompt);
        return JSON.parse(response) as T;
    }
}
```

## 故障排除

### ChromaDB 连接失败

```
❌ ChromaDB 连接失败，请确保 ChromaDB 服务已启动
```

**解决方法**：
```bash
docker run -p 8000:8000 chromadb/chroma
```

### DuckDB 挂载失败

确保 SQLite 数据库文件存在且可读。程序会自动创建 `./data` 目录。

### 淘汰策略报错

如果 `runMaintenance` 报错，检查 DuckDB 是否正确挂载了 SQLite 数据库。

## 许可证

MIT
