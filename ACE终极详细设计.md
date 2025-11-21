# 自主认知实体 (ACE) 框架 ace-engine-core Node.js SDK 架构设计报告

## 1. 执行摘要与设计愿景
随着生成式人工智能（GAI）技术的飞速发展，尤其是大语言模型（LLM）的日益普及，人工智能的研究重心正从单纯的模型训练转向代理认知架构（Agentic Cognitive Architectures）的设计。在这一领域中，由 David Shapiro 及其团队提出的 自主认知实体（Autonomous Cognitive Entity, ACE） 框架，因其严谨的层级结构、仿生学的执行功能设计以及对“认知优先（Cognition-First）”原则的坚持，成为了构建通用人工智能（AGI）代理的重要蓝图 1。本报告旨在详尽阐述 ace-engine-core npm SDK 的架构设计方案。该 SDK 专为 Node.js 环境打造，旨在为开发者提供一个严格遵循 ACE 论文定义的、生产级可用的核心引擎。设计方案不仅在逻辑层面上复现了 ACE 的六层架构与双向通信总线，更在物理实现层面针对 Node.js 的异步非阻塞特性进行了深度优化。本设计方案的核心创新在于其 复合存储架构（Composite Storage Architecture） 与 分层记忆系统（Tiered Memory System）。针对用户提出的严格要求，我们设计了一套融合 SQLite 的事务一致性与 DuckDB 的分析能力的混合存储层；利用 Redis 与内存的双模缓存机制保障了短期记忆的高效流转；并集成了 ChromaDB 作为长期语义记忆的载体。本报告将分章节详细论述这一架构的理论基础、组件设计、数据流转机制及具体的实现规范，字数规模约为 15,000 字，旨在为高阶研发人员提供一份详尽的实施指南。

## 2. 理论基础：ACE 框架的解构与 Node.js 适配
在深入代码层面的设计之前，必须对 ACE 框架的理论内核进行彻底的解构，并论证其在 Node.js 环境下的适配性。ACE 并非简单的模块堆叠，它模拟了人类神经系统的层级控制机制。

### 2.1 “认知优先”的设计哲学
ACE 框架的核心理念是“认知优先（Cognition-First）”。传统的人工智能代理（Agent）往往采用简单的“感知-行动”循环（Sensorimotor Loop），即直接对外部刺激做出反应。这种模式在处理复杂、长周期的任务时往往显得力不从心，且缺乏连贯的自我意识 2。ACE 框架通过引入内部认知循环，打破了这种依赖性。即使在没有外部输入的情况下，ACE 代理依然可以通过内部的层级交互进行“思考”、反思过去的行为、优化未来的策略。对于 Node.js SDK 的设计而言，这意味着核心引擎不能仅仅是一个响应 HTTP 请求的被动服务，而必须包含一个独立于 I/O 事件的 认知调度器（Cognitive Scheduler），即“心跳”机制，驱动各层级在后台持续进行信息的消化与策略的迭代。

### 2.2 六层层级架构的严格定义
ace-engine-core 的核心架构严格映射 ACE 论文中的六个层级，每个层级在 SDK 中都被封装为独立的模块，拥有严格定义的输入输出接口。

#### 2.2.1 愿景层 (The Aspirational Layer)
这是认知的最高层级，充当代理的“道德罗盘”或“宪法”。它不负责具体的任务执行，甚至不制定具体的战略，而是负责确立代理的终极使命、伦理底线和核心价值观（如 David Shapiro 提出的“启发式指令”：减少痛苦、增加繁荣、增加理解）。在 SDK 实现中，愿景层是 南向总线（Southbound Bus） 的最高发令者，也是 北向总线（Northbound Bus） 的最终审计者 4。

#### 2.2.2 全局策略层 (The Global Strategy Layer)
位于愿景层之下，该层级类似于企业的 CEO。它负责将抽象的愿景转化为基于当前世界状态的具体战略目标。它维护着对外部世界的宏观理解（Context），并据此制定长期的里程碑 4。

#### 2.2.3 代理模型层 (The Agent Model Layer)
这是代理的“自我意识”或“自我模型”。它存储了代理当前的能力（Capabilities）、配置状态、资源限制以及自身的完整性检查逻辑。它确保全局策略层下发的战略在物理和逻辑上是可行的。如果策略层要求“飞行”，而代理模型层明确记录自身“没有飞行模块”，则会拒绝该指令 4。

#### 2.2.4 执行功能层 (The Executive Function Layer)
该层级扮演项目经理的角色。它接收经过验证的战略目标，并将其分解为详细的任务序列（Workflow）或有向无环图（DAG）。它负责资源分配、进度预测以及具体的规划制定 4。

#### 2.2.5 认知控制层 (The Cognitive Control Layer)
这是动态的战术指挥官。它负责监控任务的实时执行情况，管理注意力切换（Context Switching）和挫折感（Frustration）。当某个具体任务失败时，认知控制层决定是重试、切换任务还是向上传递失败信号请求重新规划 2。

#### 2.2.6 任务执行层 (The Task Prosecution Layer)
这是最底层的执行单元，类似于人类的手脚。它直接与外部 API、文件系统或硬件接口进行交互。它是唯一允许产生副作用（Side Effects）的层级，也是北向感知数据的原始来源 4。

### 2.3 双向总线通信机制
ACE 框架借鉴了 OSI 模型的层级隔离思想，并未采用全连接的网络结构，而是严格定义了两个单向通信总线：北向总线 (Northbound Bus)：承载数据、状态、感知信息和执行结果。信息流向为：任务执行层 $\rightarrow$ 认知控制层 $\rightarrow$ 执行功能层 $\rightarrow$ 代理模型层 $\rightarrow$ 全局策略层 $\rightarrow$ 愿景层。越向上传递，信息越抽象，数据量越经过压缩和综合 4。南向总线 (Southbound Bus)：承载指令、控制信号、战略意图和具体任务。信息流向与北向相反。越向下传递，指令越具体，越接近机器码或 API 调用 4。在 Node.js 中，利用 EventEmitter 或类似的消息队列机制实现这一双总线架构是极其自然的，这将在后续章节中详细展开。

## 3. ace-engine-core 核心架构设计
本章将详细阐述 SDK 的核心基础设施，包括依赖选择策略、总线系统的具体实现、以及满足复合存储与分级缓存要求的物理架构。

### 3.1 依赖选择与设计原则
遵循用户提出的优先级（依赖安装 > 轻量组件 > 较大体量组件），我们在设计时采取了极其审慎的选型策略。组件类别选型方案优先级依据备注运行时环境Node.js (LTS)基础环境利用其异步非阻塞 I/O 优势处理高并发认知流。事件总线eventemitter3轻量组件比原生 events 模块性能更优，支持更大吞吐量。核心存储 (OLTP)better-sqlite3轻量组件Node.js 生态中最快、最稳定的同步 SQLite 驱动。分析存储 (OLAP)duckdb较大体量满足用户对 DuckDB 的明确需求，用于海量日志分析。向量数据库chromadb依赖安装官方客户端，满足向量记忆层需求 7。缓存系统ioredis + lru-cache混合生产环境使用 Redis，开发环境回退至内存 LRU。Schema 校验zod轻量组件运行时类型检查，确保总线消息格式严格合规。唯一 ID 生成uuid 或 nanoid轻量组件标准化组件。

### 3.2 总线系统 (The Bus System) 设计
总线系统是 ACE 引擎的神经中枢。它不仅负责传递消息，还负责强制执行通信协议。

#### 3.2.1 通信协议规范
根据 ACE 框架的要求，层间通信必须使用“人类可读的自然语言” 4。为了便于程序处理，我们将自然语言封装在标准化的 JSON 信封中。南向指令 (Southbound Directive) 接口定义：TypeScript
/**
 * 南向指令数据包结构
 * 用于上层向下层下达命令、策略或任务
 */
interface SouthboundPacket {
  id: string;               // UUID
  timestamp: number;        // Unix 时间戳
  traceId: string;          // 链路追踪 ID，用于关联一次完整的认知循环
  
  sourceLayer: AceLayerID;  // 枚举：ASPIRATIONAL, GLOBAL_STRATEGY,...
  targetLayer: AceLayerID;  // 枚举：GLOBAL_STRATEGY, AGENT_MODEL,...
  
  type: SouthboundType;     // 枚举：IMPERATIVE, STRATEGY, PLAN, INSTRUCTION, CONTROL
  
  content: string;          // 核心负载：自然语言描述的指令
                            // 例如："检索用户关于 ACE 框架的文档并总结核心观点。"
                            
  parameters?: Record<string, any>; // 结构化参数，辅助执行
                                    // 例如：{ "max_tokens": 500, "timeout": 3000 }
}
北向遥测 (Northbound Telemetry) 接口定义：TypeScript
/**
 * 北向遥测数据包结构
 * 用于下层向上层汇报状态、结果或感知信息
 */
interface NorthboundPacket {
  id: string;
  timestamp: number;
  traceId: string;
  
  sourceLayer: AceLayerID;
  targetLayer: AceLayerID;
  
  type: NorthboundType;     // 枚举：OBSERVATION, RESULT, STATUS, FAILURE, EPIPHANY
  
  summary: string;          // 核心负载：自然语言描述的状态摘要
                            // 例如："文件读取成功，共发现 3 个相关文档。"
                            
  data?: any;               // 原始数据负载
                            // 例如：文件内容的 Buffer 或完整的 JSON 对象
}
#### 3.2.2 BusManager 实现逻辑
BusManager 类负责管理两个独立的 EventEmitter 实例。它实现了中间件模式（Middleware Pattern），允许开发者插入日志记录、安全审计或调试工具。JavaScript
// 伪代码示意
class BusManager {
  constructor() {
    this.northbound = new EventEmitter();
    this.southbound = new EventEmitter();
    this.middlewares =;
  }

  use(middleware) {
    this.middlewares.push(middleware);
  }

  async publishSouthbound(packet) {
    // 1. 运行时 Schema 校验 (Zod)
    SouthboundSchema.parse(packet);
    
    // 2. 执行中间件 (用于安全审计层 Security Overlay)
    for (const mw of this.middlewares) {
      if (await mw.inspect(packet) === 'BLOCK') {
        throw new SecurityError('指令违反安全策略');
      }
    }
    
    // 3. 持久化日志 (DuckDB)
    await this.logger.logSouthbound(packet);
    
    // 4. 事件分发
    this.southbound.emit(packet.targetLayer, packet);
  }
  
  // publishNorthbound 同理...
}

### 3.3 物理存储层：复合模式 (Composite Mode)
用户明确要求物理存储层支持 SQLite、DuckDB 或复合模式。在 ace-engine-core 中，我们强烈推荐并默认采用 复合模式，因为 ACE 代理的数据访问模式呈现极端的两极分化：状态数据 (State Data)：如当前的配置、正在执行的任务队列、层级锁状态。这类数据读写频繁，要求极低的延迟和事务一致性（ACID）。日志数据 (Log Data)：如历史的思维链、所有的北向遥测数据、南向指令历史。这类数据是追加写入（Append-only），且查询时往往涉及大规模的聚合分析（OLAP）。

#### 3.3.1 SQLite：作为“海马体” (The Hippocampus)
SQLite 被用作代理的即时状态存储。它保存了代理“当前”所知的一切。表结构设计 (Schema Design)：layer_state: 存储各层当前的内部状态机快照。agent_capabilities: 存储代理模型层的工具定义。active_goals: 存储当前正在追踪的战略目标及其完成度。kv_store: 通用的键值对存储，用于配置项。配置优化：开启 WAL (Write-Ahead Logging) 模式以支持更高的并发读写。

#### 3.3.2 DuckDB：作为“皮层记录” (The Cortical Record)
DuckDB 被用作代理的长期遥测仓库。它允许代理进行“元认知（Metacognition）”——即思考自己的思考过程。表结构设计：telemetry_stream: 存储所有 Northbound 消息。利用 DuckDB 的列式存储特性，可以高效压缩大量的文本摘要。directive_history: 存储所有 Southbound 指令。performance_metrics: 存储任务执行的耗时、Token 消耗、成功率等指标。查询优势：全局策略层可以通过 SQL 查询 DuckDB，回答如“过去 24 小时内，哪类任务的失败率最高？”这类复杂问题，从而动态调整策略 8。

### 3.4 缓存层：双模自适应 (Dual-Mode Adaptive)
缓存层用于存储 短期记忆（Short-Term Memory） 和 上下文窗口（Context Window） 的内容。

#### 3.4.1 配置策略
SDK 提供 CacheManager 类，根据初始化配置决定底层实现：Redis 模式：生产环境推荐。支持跨进程共享内存，支持数据持久化（RDB/AOF），即使 Node.js 进程重启，代理的短期上下文也不会丢失 10。内存模式 (LRU)：开发环境或轻量级部署使用。基于 lru-cache 库，零外部依赖，但在进程重启后数据清空。

#### 3.4.2 数据结构
context_window:{sessionId} (List): 存储最近 N 轮对话或思维链的 Token 序列。layer_lock:{layerId} (String): 用于层级间的并发控制。

### 3.5 向量记忆层：ChromaDB 集成
长期记忆在 ACE 中是语义化的。我们使用 ChromaDB 来存储 情节记忆（Episodic Memory） 和 语义知识（Semantic Knowledge） 7。集合划分 (Collections)：ace_episodic: 存储过去交互的叙事性摘要。ace_knowledge: 存储从文档或外部源摄入的事实性知识。ace_procedures: 存储成功的执行计划（Workflow），以便在未来遇到相似目标时直接复用（类似于人类的程序性记忆）。交互逻辑：当 context_window（Redis）中的数据因超出长度被挤出时，并不直接丢弃，而是触发一个后台任务，将这些内容摘要并向量化，存入 ace_episodic 集合。这模拟了人类从短期记忆向长期记忆巩固的过程。

## 4. 层级详细实施规范 (Layer Implementation Specifications)
本章将深入每一个层级的内部逻辑，定义其状态机、处理流程及与其他层级的交互细节。

### 4.1 愿景层 (The Aspirational Layer)
#### 4.1.1 功能定义
愿景层是系统的最高仲裁者。它不产生具体的行动，而是产生约束。

#### 4.1.2 内部组件
宪法加载器 (Constitution Loader): 在启动时从 constitution.md 或环境变量中加载核心指令。伦理审查引擎 (Ethical Adjudicator): 一个基于 LLM 的判断循环。

#### 4.1.3 处理流程
监听：订阅北向总线的 EPIPHANY（顿悟）或 CRITICAL_FAILURE（严重失败）事件。南向拦截：在全局策略层发出新的战略之前，愿景层会进行“预检（Pre-flight Check）”。系统提示词 (System Prompt)：“你是一个遵循伦理规范的 AI 监管者。以下是下层提交的战略计划，请判断其是否违反了‘减少痛苦、增加繁荣’的核心指令？如果违反，请输出 VETO 及原因。” 12。输出：如果审查通过，放行指令；如果拒绝，向南向总线发送 VETO 类型指令，强制全局策略层重做。

### 4.2 全局策略层 (The Global Strategy Layer)
#### 4.2.1 功能定义
维护世界模型，制定宏观目标。

#### 4.2.2 接口与数据
输入：愿景层的约束、代理模型层的能力报告、DuckDB 中的历史趋势。输出：一组高层级的战略目标（Milestones）。

#### 4.2.3 核心逻辑：环境语境化 (Contextualization)
该层的一个关键任务是解决“幻觉”问题。它通过多源验证来确保策略的现实性。算法：从 ChromaDB 检索与当前任务相关的长期记忆。从 DuckDB 查询最近的失败记录。结合愿景层的指令，生成一个新的战略文档。将该文档发布到南向总线。

### 4.3 代理模型层 (The Agent Model Layer)
#### 4.3.1 功能定义
提供“自我认知”。它必须准确知道系统能做什么，不能做什么。

#### 4.3.2 存储 Schema (SQLite)
SQL
CREATE TABLE capabilities (
    id INTEGER PRIMARY KEY,
    tool_name TEXT NOT NULL UNIQUE,
    description TEXT,
    input_schema JSON, -- JSON Schema 格式的参数定义
    is_active BOOLEAN DEFAULT 1,
    risk_level INTEGER -- 1-5，用于安全控制
);

#### 4.3.3 能力协商机制 (Capability Negotiation)
当全局策略层下达目标“扫描内网所有主机”时，代理模型层会查询 capabilities 表。如果发现 network_scan 工具且 is_active=1，则将目标转化为可执行的范围约束，传递给执行功能层。如果未发现该工具，或者 risk_level 超过了当前的安全阈值，代理模型层会向北向总线发送 CAPABILITY_ERROR，并在南向总线拦截该指令。

### 4.4 执行功能层 (The Executive Function Layer)
#### 4.4.1 功能定义
负责具体的规划（Planning）和资源调度。它是将“战略”转化为“战术”的转化器。

#### 4.4.2 规划引擎 (Planner Engine)
该层集成了一个基于 LLM 的规划器。不同于简单的 Chain-of-Thought，这里采用 DAG（有向无环图）生成模式。流程：接收战略目标。生成任务列表及其依赖关系（例如：任务 B 依赖任务 A 的输出）。资源估算：为每个任务估算所需的 Token 预算和时间预算。将生成的计划序列化存储到 Redis 的 active_plan:{id} 中 4。

### 4.5 认知控制层 (The Cognitive Control Layer)
#### 4.5.1 功能定义
负责注意力管理和任务切换。它是 ACE 框架中唯一具有“实时”特性的层级。

#### 4.5.2 状态机管理
该层维护一个名为 FocusState 的状态机：IDLE: 等待任务。EXECUTING: 正在监控任务执行层。BLOCKED: 等待外部资源。FRUSTRATED: 任务连续失败，需要干预。

#### 4.5.3 挫折感机制 (Frustration Mechanic)
这是一个关键的仿生学设计。逻辑：维护一个计数器 failure_count。当任务执行层返回 FAILURE 时，计数器 +1。如果 failure_count > threshold (可配置)，认知控制层会停止当前的重试循环，向北向总线发送 FRUSTRATION_SIGNAL。执行功能层收到该信号后，会触发“重规划（Re-planning）”流程 4。

### 4.6 任务执行层 (The Task Prosecution Layer)
#### 4.6.1 功能定义
与外部世界交互的边界。

#### 4.6.2 工具注册系统 (Tool Registry)
SDK 提供一个插件式的工具注册接口。TypeScript
interface AceTool {
  name: string;
  description: string;
  execute: (params: any) => Promise<any>;
  schema: object; // Zod schema
}
开发者可以通过 ace.registerTool() 方法将自定义的 JavaScript 函数注入到该层。

#### 4.6.3 安全沙箱 (Safety Sandbox)
为了防止 LLM 生成恶意代码，该层建议在 Node.js 的 vm 模块或独立的 Docker 容器中执行非预设的代码。但在基础 SDK 中，我们将重点放在预定义工具的安全调用上，对每个调用进行参数校验。

## 5. SDK API 参考与开发者体验 (DX)
本章定义 ace-engine-core 对外暴露的 API 表面积（API Surface）。

### 5.1 初始化与配置
TypeScript
import { AceEngine } from 'ace-engine-core';

const engine = new AceEngine({
  // 1. 身份定义
  agentId: 'ace-001',
  
  // 2. 存储配置 (符合复合存储要求)
  storage: {
    mode: 'composite',
    sqlitePath: './data/state.db',
    duckdbPath: './data/logs.duckdb'
  },
  
  // 3. 缓存配置 (符合双模要求)
  cache: {
    type: process.env.REDIS_URL? 'redis' : 'memory',
    redisUrl: process.env.REDIS_URL
  },
  
  // 4. 记忆配置 (ChromaDB)
  memory: {
    provider: 'chroma',
    endpoint: 'http://localhost:8000',
    collectionPrefix: 'ace_v1'
  },
  
  // 5. 模型注入 (依赖注入模式)
  llm: {
    driver: new OpenAIProvider({ apiKey: '...' }),
    modelMap: {
      'aspirational': 'gpt-4', // 高智力模型用于伦理判断
      'prosecution': 'gpt-3.5-turbo' // 快速模型用于简单任务
    }
  }
});

await engine.start();

### 5.2 扩展性设计：中间件
为了增加灵活性，SDK 允许开发者拦截总线消息。TypeScript
// 添加一个日志中间件
// 注意：使用 BusDirection 枚举确保类型安全，而不是字符串字面量
import { BusDirection } from 'ace-engine-core';

engine.bus.use(BusDirection.SOUTHBOUND, async (packet, next) => {
  console.log(`${packet.sourceLayer} -> ${packet.targetLayer}: ${packet.content}`);
  await next();
});

// 类型安全的优势：
// - TypeScript 会在编译时检查方向参数
// - IDE 可以提供自动补全
// - 避免拼写错误（如 'southbound' vs 'SOUTHBOUND'）

## 6. 运营动力学与安全性 (Operational Dynamics & Security)
### 6.1 认知循环 (The Cognitive Cycle)
Node.js 是事件驱动的，但 ACE 代理需要主动思考。我们通过 CognitiveScheduler 实现这一点。心跳 (Heartbeat): 每隔固定时间（如 1秒），触发一次 Cognitive Control 检查。反思周期 (Reflection Cycle): 每隔较长时间（如 5分钟），触发一次 Global Strategy 的自我评估，查询 DuckDB 中的性能指标，调整长期策略。

### 6.2 安全覆盖层 (Security Overlay)
根据 ACE 框架要求，必须有一个独立于 AI 模型的安全层 4。实现：在 SDK 中，这是一个硬编码的规则引擎，位于 BusManager 内部。规则示例：禁止任何层级向 TaskProsecution 发送包含 rm -rf / 或类似高危命令的指令。检测南向指令中的死循环（即重复发送相同的指令 ID）。强制所有北向敏感数据（如 API Key）在写入 DuckDB 日志前进行脱敏（Redaction）。

## 7. 总结与展望
本报告详细阐述了 ace-engine-core 的设计蓝图。该设计不仅仅是对 David Shapiro 论文的各种概念的简单翻译，而是结合了 Node.js 生态系统的最佳实践（如异步 I/O、事件驱动、轻量级依赖）进行的深度工程化重构。通过引入 SQLite + DuckDB 的复合存储，我们解决了状态一致性与日志分析性能之间的矛盾；通过 Redis + ChromaDB 的分级记忆，我们实现了短期上下文与长期语义记忆的无缝流转。更重要的是，通过严格的 北向/南向总线 协议和 Zod Schema 校验，我们确保了系统的健壮性与可观测性。该 SDK 的完成将标志着 ACE 框架从理论概念向工业级应用的重大跨越，为构建真正自主、伦理对齐的认知智能体提供了坚实的基石。

## 附录：数据表结构速查表
### 表 1: SQLite 状态表定义
| 表名         | 字段摘要                                           | 用途             | 关联层级        |
| ------------ | -------------------------------------------------- | ---------------- | --------------- |
| layer_state  | layer_id, status, last_heartbeat, config_json      | 维护各层运行状态 | All Layers      |
| capabilities | id, tool_name, schema, permissions                 | 定义代理可用工具 | Agent Model     |
| active_goals | goal_id, description, progress, parent_strategy_id | 追踪当前目标进度 | Global Strategy |

### 表 2: DuckDB 日志表定义
| 表名           | 字段摘要                                    | 用途             | 关联层级          |
| -------------- | ------------------------------------------- | ---------------- | ----------------- |
| telemetry_log  | ts, trace_id, source, summary, embedding_id | 全量北向数据归档 | All Layers        |
| directives_log | ts, trace_id, source, command, status       | 全量南向指令归档 | All Layers        |
| metrics        | ts, layer, metric_name, value               | 性能与健康度分析 | Cognitive Control |

(报告结束)