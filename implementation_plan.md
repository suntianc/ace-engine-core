# ACE Engine Core - 实施方案与计划 (Implementation Plan)

本计划基于《总体设计方案》、《详细设计方案》及《Design Review》制定，旨在落地一个高性能、具备自进化能力的 Agent 框架。

## 1. 实施策略 (Implementation Strategy)

### 1.1 核心技术栈确认
*   **Runtime**: Node.js (TypeScript)
*   **Vector Store**: ChromaDB (via `chromadb` client)
*   **Transaction Store**: SQLite (via `better-sqlite3`, 开启 WAL 模式)
*   **Analytics Engine**: DuckDB (via `duckdb-async`, 零拷贝挂载)
*   **Validation**: Zod (用于 LLM 输出校验，响应 Design Review 建议)
*   **LLM Abstraction**: LangChain / AI SDK (待定，暂定直接封装 API 以减少依赖)

### 1.2 关键架构决策 (响应 Design Review)
1.  **Prompt 管理**: 所有的 System Prompts 不硬编码，统一存放在 `src/prompts/*.ts` 或资源文件中，并引入版本号。
2.  **鲁棒性设计**: 在 SQLite `trajectories` 表中增加 `evolution_status` 字段，用于追踪后台进化任务的状态（Pending/Processing/Completed/Failed），实现“死信队列”机制。
3.  **类型安全**: 引入 `zod` 对 Generator 和 Reflector 的 LLM 结构化输出进行运行时校验。
4.  **防抖机制**: Curator 在生成新规则前，必须查询 `delta_logs` 检查近期是否已有类似变更。

---

## 2. 实施阶段规划 (Phased Roadmap)

### Phase 1: 基础设施与“快路径” (Foundation & Hot Path)
**目标**: 完成骨架搭建，实现 `run(task)` 主流程，数据能正确写入 SQLite 和 Chroma。

*   **1.1 工程初始化**
    *   初始化 npm 项目，配置 TypeScript, ESLint, Prettier。
    *   安装依赖: `better-sqlite3`, `chromadb`, `zod`, `uuid`, `dotenv`。
    *   建立目录结构 (参照详细设计)。
*   **1.2 核心接口定义**
    *   定义 `src/types.ts` (Rule, Trajectory, Delta)。
    *   定义 `src/interfaces/store.ts` (IVectorStore, ITransactionStore)。
*   **1.3 存储适配器实现**
    *   **SQLiteAdapter**: 实现建表 (含 `evolution_status`)、同步写入 `saveTrajectory`。确保 WAL 开启。
    *   **ChromaAdapter**: 实现 `search`, `add`, `update`, `delete`。
*   **1.4 Generator (执行器)**
    *   实现 Prompt 组装逻辑 (System + Context + User Task)。
    *   集成 LLM API。
    *   使用 `zod` 校验 LLM 返回的 JSON。
    *   实现 `AceAgent.run()` 方法，串联 Retrieve -> Generate -> Persist。

### Phase 2: 异步进化与“慢路径” (Evolution & Cold Path)
**目标**: 实现后台的 Reflector 和 Curator，让 Agent 具备自我反思和更新能力。

*   **2.1 Reflector (反思器)**
    *   设计 Reflection Prompt。
    *   实现 `analyze(trajectory)` 方法，输出结构化 Insight。
    *   错误处理：如果 LLM 失败，更新 SQLite 状态为 `Failed`。
*   **2.2 Curator (策展器) - 基础版**
    *   实现 `plan(insight)`：根据反思结果决定是否更新规则。
    *   实现 `IVectorStore` 的更新逻辑。
    *   记录 `delta_logs` 到 SQLite。
*   **2.3 事件驱动集成**
    *   在 `AceAgent` 中完善 `EventEmitter`。
    *   实现 `evolve` 循环：监听任务完成 -> 触发 Reflector -> 触发 Curator。

### Phase 3: 分析增强与鲁棒性 (Analytics & Resilience)
**目标**: 引入 DuckDB 进行高级分析，完善防抖和清理机制。

*   **3.1 DuckDB 集成**
    *   实现 `DuckDBAdapter`。
    *   **关键任务**: 编写脚本验证 `better-sqlite3` (Writer) 与 `DuckDB` (Reader) 在 WAL 模式下的并发兼容性。
*   **3.2 高级 Curator 逻辑**
    *   实现 **Novelty Check**: 利用 DuckDB 查询历史轨迹，判断是否是重复问题。
    *   实现 **Debounce**: 过滤短期内的重复规则更新。
*   **3.3 维护机制**
    *   实现“遗忘机制”脚本：定期清理长期未使用的 Rules。

### Phase 4: 测试与交付 (QA & Delivery)
**目标**: 确保稳定性，交付可用 SDK。

*   **4.1 单元测试**
    *   实现 `InMemoryVectorStore` 和 `InMemoryTransactionStore` 用于 Mock 测试。
    *   测试 Generator 的 Prompt 组装逻辑。
*   **4.2 集成测试**
    *   编写 `examples/basic-usage.ts`，端到端跑通一个真实任务。
*   **4.3 文档**
    *   编写 `README.md`，包含安装、配置和架构图。

---

## 3. 详细任务清单 (Task Breakdown)

### Day 1-2: 骨架与存储
- [ ] 初始化项目结构 (`src/`, `tests/`, `tsconfig.json`)
- [ ] 定义 `Rule`, `Trajectory`, `DeltaLog` 接口
- [ ] 实现 `SQLiteAdapter` (Schema: trajectories, delta_logs)
- [ ] 实现 `ChromaAdapter` (Collection: ace_playbook)

### Day 3-4: Generator 与主流程
- [ ] 编写 `src/prompts/generator.ts` (带版本号)
- [ ] 实现 `Generator` 类与 Zod Schema
- [ ] 实现 `AceAgent.run()` 主入口
- [ ] 验证: 运行任务，检查 SQLite 是否有记录

### Day 5-6: Reflector 与 Curator
- [ ] 编写 `src/prompts/reflector.ts` & `curator.ts`
- [ ] 实现 `Reflector.analyze()`
- [ ] 实现 `Curator.process()` (含基础去重)
- [ ] 联调: 运行任务，观察 Console 输出 "Evolved!"

### Day 7: DuckDB 与高级特性
- [ ] 验证 DuckDB 挂载 SQLite (Read-Only 模式)
- [ ] 在 Curator 中接入 DuckDB 查询历史
- [ ] 实现 Curator 的防抖逻辑
- [ ] 实现“遗忘机制” (Elimination Strategy): 基于 DuckDB 统计清理长期未使用的规则

### Day 8: 收尾与测试
- [ ] 编写 Mock Store
- [ ] 编写 Jest 测试用例
- [ ] 完善 README 文档

## 4. 风险管理

| 风险点            | 缓解措施                                                        |
| :---------------- | :-------------------------------------------------------------- |
| **SQLite 锁冲突** | 严格确保 DuckDB 以 `read_only=true` 挂载；SQLite 必须开启 WAL。 |
| **LLM 格式错误**  | 全面使用 `zod` 进行校验，失败时重试或降级处理。                 |
| **规则库爆炸**    | Phase 3 必须实现遗忘机制；Curator 增加严格的准入阈值。          |
