
/**
 * ACE Engine Core - Main Entry Point
 * @version 1.0.0
 */

export { AceEngine } from './ace_engine';
export * from './types';
export { BusManager } from './core/bus';

// 🆕 显式导出枚举（修复运行时 undefined 问题）
export { AceLayerID, SouthboundType, NorthboundType } from './types';

// Export Error Types
export {
    AceError,
    SecurityError,
    CapabilityError,
    ValidationError,
    StorageError,
    ConfigurationError
} from './utils/errors';

// Export Configuration Interfaces (explicitly listed for better discoverability)
export type {
    AceEngineConfig,
    AceStorageConfig,
    AceCacheConfig,
    AceMemoryConfig,
    AceLLMConfig,
    AceSchedulerConfig,
    AceContextWindowConfig,
    AceReflectionTriggerConfig
} from './types';

// Export Reflection Trigger Types
export {
    ReflectionTriggerType,
    ReflectionLevel
} from './types/reflection';

export type {
    ReflectionTrigger,
    ReflectionTriggerConfig,
    StateComparison
} from './types/reflection';

// Export Reflection Trigger Engine
export { ReflectionTriggerEngine } from './core/reflection_trigger';

// Export Session Management Types
export type {
    SessionState,
    SessionManager
} from './types/session';

export { SessionManagerImpl } from './core/session_manager';

// Export Layers for extension if needed
export { AspirationalLayer } from './layers/aspirational';
export { GlobalStrategyLayer } from './layers/global_strategy';
export { AgentModelLayer } from './layers/agent_model';
export { ExecutiveFunctionLayer } from './layers/executive_function';
export { CognitiveControlLayer } from './layers/cognitive_control';
export { TaskProsecutionLayer } from './layers/task_prosecution';
