/**
 * ACE Engine Core - 主导出文件
 * @version 1.0.0
 */

// 主类
export { AceAgent, AceAgentConfig } from './agent';

// 核心组件
export { Generator, GeneratorConfig } from './core/generator';
export { Reflector, ReflectorConfig } from './core/reflector';
export { Curator, CuratorConfig } from './core/curator';

// 类型定义
export {
    Rule,
    Trajectory,
    TaskStep,
    Delta,
    DeltaLog,
    Insight,
    BaseLLM,
} from './types';

// 接口定义
export {
    IVectorStore,
    ITrajectoryStore,
    IAnalysisEngine,
} from './interfaces/store';

// 适配器
export { SQLiteAdapter } from './adapters/sqlite-adapter';
export { DuckDBAdapter } from './adapters/duckdb-adapter';
export { ChromaAdapter } from './adapters/chroma-adapter';

// Schema
export {
    GeneratorOutputSchema,
    ReflectorOutputSchema,
    CuratorOutputSchema,
} from './utils/schemas';

// 工具函数
export {
    generateId,
    extractJSON,
    safeParseJSON,
    delay,
    retry,
} from './utils/helpers';
