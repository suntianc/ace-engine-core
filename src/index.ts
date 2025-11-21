
/**
 * ACE Engine Core - Main Entry Point
 * @version 1.0.0
 */

export { AceEngine } from './ace_engine';
export * from './types';
export { BusManager } from './core/bus';

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
    AceContextWindowConfig
} from './types';

// Export Layers for extension if needed
export { AspirationalLayer } from './layers/aspirational';
export { GlobalStrategyLayer } from './layers/global_strategy';
export { AgentModelLayer } from './layers/agent_model';
export { ExecutiveFunctionLayer } from './layers/executive_function';
export { CognitiveControlLayer } from './layers/cognitive_control';
export { TaskProsecutionLayer } from './layers/task_prosecution';
