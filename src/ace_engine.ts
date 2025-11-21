import { AceEngineConfig, BaseLLM, AceLayerID } from './types';
import { BusManager, BusDirection } from './core/bus';
import { SQLiteStorage } from './storage/sqlite';
import { DuckDBStorage } from './storage/duckdb';
import { ChromaStorage } from './storage/chroma';
import { MemoryStorage } from './storage/memory';
import { BaseLayer, AceStorages } from './layers/base';
import { ConfigurationError, StorageError } from './utils/errors';

import { AspirationalLayer } from './layers/aspirational';
import { GlobalStrategyLayer } from './layers/global_strategy';
import { AgentModelLayer } from './layers/agent_model';
import { ExecutiveFunctionLayer } from './layers/executive_function';
import { CognitiveControlLayer } from './layers/cognitive_control';
import { TaskProsecutionLayer } from './layers/task_prosecution';
import { CognitiveScheduler } from './core/scheduler';

export class AceEngine {
    public bus: BusManager;
    public storage: AceStorages;
    private config: AceEngineConfig;
    private layers: BaseLayer[];
    private scheduler: CognitiveScheduler;

    getMemory() {
        return this.storage.memory;
    }

    constructor(config: AceEngineConfig) {
        // Validate configuration before initialization
        this.validateConfig(config);
        this.config = config;
        
        // Initialize Storage first for BusManager dependency injection
        this.storage = {
            sqlite: new SQLiteStorage(config.storage.sqlitePath),
            duckdb: new DuckDBStorage(),
            chroma: new ChromaStorage(config.memory.endpoint, config.memory.collectionPrefix),
            memory: new MemoryStorage(config.cache, config.contextWindow?.maxLength)
        };
        
        // Initialize BusManager with storage dependency for internal logging
        this.bus = new BusManager({ duckdb: this.storage.duckdb });

        // Storage already initialized above for BusManager dependency injection

        // Handle Context Window Eviction -> Long-term Memory
        this.storage.memory.on('eviction', async (event: { sessionId: string, content: string }) => {
            try {
                await this.storage.chroma.addEpisodic(event.sessionId, event.content, {
                    source: 'context_window_eviction',
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error('Failed to consolidate episodic memory:', error);
            }
        });

        // Initialize Scheduler with optional configuration
        this.scheduler = new CognitiveScheduler(
            this.bus,
            config.scheduler?.heartbeatIntervalMs,
            config.scheduler?.reflectionIntervalMs
        );

        // Initialize Layers
        const llmDriver = config.llm.driver;

        // Create LLM wrapper class to support model selection
        class LLMWrapper implements BaseLLM {
            private driver: BaseLLM;
            private modelName: string | null;

            constructor(driver: BaseLLM, modelName: string | null = null) {
                this.driver = driver;
                this.modelName = modelName;
            }

            async generate(prompt: string): Promise<string> {
                // If driver supports model selection via withModel method, use it
                const driverWithModel = this.driver as BaseLLM & { withModel?: (model: string) => BaseLLM };
                if (this.modelName && driverWithModel.withModel) {
                    const modelDriver = driverWithModel.withModel(this.modelName);
                    return modelDriver.generate(prompt);
                }
                // Otherwise, pass model name via options if supported
                const driverWithOptions = this.driver as BaseLLM & { generate?: (prompt: string, options?: { model?: string }) => Promise<string> };
                if (this.modelName && driverWithOptions.generate) {
                    // Try to pass model as second parameter if driver supports it
                    try {
                        return await driverWithOptions.generate(prompt, { model: this.modelName });
                    } catch {
                        // Fallback to default behavior
                        return this.driver.generate(prompt);
                    }
                }
                return this.driver.generate(prompt);
            }

            async generateStructured<T>(prompt: string, schema: unknown): Promise<T> {
                // If driver supports model selection via withModel method, use it
                const driverWithModel = this.driver as BaseLLM & { withModel?: (model: string) => BaseLLM };
                if (this.modelName && driverWithModel.withModel) {
                    const modelDriver = driverWithModel.withModel(this.modelName);
                    return modelDriver.generateStructured<T>(prompt, schema);
                }
                // Otherwise, pass model name via options if supported
                const driverWithOptions = this.driver as BaseLLM & { generateStructured?: <T>(prompt: string, schema: unknown, options?: { model?: string }) => Promise<T> };
                if (this.modelName && driverWithOptions.generateStructured) {
                    try {
                        return await driverWithOptions.generateStructured<T>(prompt, schema, { model: this.modelName });
                    } catch {
                        // Fallback to default behavior
                        return this.driver.generateStructured<T>(prompt, schema);
                    }
                }
                return this.driver.generateStructured<T>(prompt, schema);
            }
        }

        // Model instance cache to avoid creating duplicate wrappers
        const modelInstanceCache = new Map<string, BaseLLM>();
        const defaultModelKey = '__default__';

        // Helper to get LLM for a layer based on modelMap configuration
        const getLLM = (layerId: string): BaseLLM => {
            // Map layer IDs to modelMap keys
            const layerModelMap: Record<string, string> = {
                'ASPIRATIONAL': 'aspirational',
                'GLOBAL_STRATEGY': 'global_strategy',
                'AGENT_MODEL': 'agent_model',
                'EXECUTIVE_FUNCTION': 'executive_function',
                'COGNITIVE_CONTROL': 'cognitive_control',
                'TASK_PROSECUTION': 'task_prosecution',
                // Also support alternative names
                'prosecution': 'task_prosecution'
            };

            const modelKey = layerModelMap[layerId] || layerId.toLowerCase();
            const modelName = config.llm.modelMap?.[modelKey];

            // Use default driver if no model specified or model is 'default'
            if (!modelName || modelName === 'default') {
                if (!modelInstanceCache.has(defaultModelKey)) {
                    modelInstanceCache.set(defaultModelKey, llmDriver);
                }
                return modelInstanceCache.get(defaultModelKey)!;
            }

            // Create or retrieve cached model instance
            if (!modelInstanceCache.has(modelName)) {
                const wrapper = new LLMWrapper(llmDriver, modelName);
                modelInstanceCache.set(modelName, wrapper);
                console.log(`[AceEngine] Created LLM instance for layer ${layerId} with model: ${modelName}`);
            } else {
                console.log(`[AceEngine] Using cached LLM instance for layer ${layerId} with model: ${modelName}`);
            }

            return modelInstanceCache.get(modelName)!;
        };

        this.layers = [
            new AspirationalLayer(this.bus, this.storage, getLLM(AceLayerID.ASPIRATIONAL)),
            new GlobalStrategyLayer(this.bus, this.storage, getLLM(AceLayerID.GLOBAL_STRATEGY)),
            new AgentModelLayer(this.bus, this.storage, getLLM(AceLayerID.AGENT_MODEL)),
            new ExecutiveFunctionLayer(this.bus, this.storage, getLLM(AceLayerID.EXECUTIVE_FUNCTION)),
            new CognitiveControlLayer(this.bus, this.storage, getLLM(AceLayerID.COGNITIVE_CONTROL)),
            new TaskProsecutionLayer(this.bus, this.storage, getLLM(AceLayerID.TASK_PROSECUTION)),
        ];

        // Note: Logging is now handled internally by BusManager
        // No need for external logging middlewares
    }

    /**
     * Validate configuration before initialization
     * @throws {ConfigurationError} if configuration is invalid
     */
    private validateConfig(config: AceEngineConfig): void {
        if (!config.agentId || config.agentId.trim() === '') {
            throw new ConfigurationError('agentId is required');
        }
        if (!config.storage.sqlitePath || config.storage.sqlitePath.trim() === '') {
            throw new ConfigurationError('storage.sqlitePath is required');
        }
        if (!config.storage.duckdbPath || config.storage.duckdbPath.trim() === '') {
            throw new ConfigurationError('storage.duckdbPath is required');
        }
        if (!config.memory.endpoint || config.memory.endpoint.trim() === '') {
            throw new ConfigurationError('memory.endpoint is required');
        }
        if (config.cache.type === 'redis' && !config.cache.redisUrl) {
            throw new ConfigurationError('cache.redisUrl is required when cache.type is "redis"');
        }
        if (!config.llm.driver) {
            throw new ConfigurationError('llm.driver is required');
        }
    }

    /**
     * Cleanup resources in case of startup failure
     */
    private async cleanup(): Promise<void> {
        const errors: Error[] = [];

        try {
            if (this.scheduler) {
                this.scheduler.stop();
            }
        } catch (error) {
            errors.push(error as Error);
        }

        try {
            if (this.storage?.duckdb) {
                await this.storage.duckdb.close();
            }
        } catch (error) {
            errors.push(error as Error);
        }

        try {
            if (this.storage?.sqlite) {
                this.storage.sqlite.close();
            }
        } catch (error) {
            errors.push(error as Error);
        }

        try {
            if (this.storage?.memory) {
                await this.storage.memory.close();
            }
        } catch (error) {
            errors.push(error as Error);
        }

        try {
            if (this.storage?.chroma) {
                await this.storage.chroma.close();
            }
        } catch (error) {
            errors.push(error as Error);
        }

        if (errors.length > 0) {
            console.warn('[AceEngine] Some resources failed to cleanup during startup failure:', errors);
        }
    }

    async start() {
        try {
            await this.storage.duckdb.connect(this.config.storage.duckdbPath);
            await this.storage.chroma.init();
            this.scheduler.start();
            console.log(`ACE Engine ${this.config.agentId} started.`);
        } catch (error) {
            // Cleanup any resources that were initialized
            await this.cleanup();
            
            // Throw appropriate error type
            if (error instanceof ConfigurationError || error instanceof StorageError) {
                throw error;
            }
            throw new StorageError(`Failed to start ACE Engine: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async stop() {
        const errors: Error[] = [];

        try {
            this.scheduler.stop();
        } catch (error) {
            errors.push(error as Error);
        }

        try {
            await this.storage.duckdb.close();
        } catch (error) {
            errors.push(error as Error);
        }

        try {
            this.storage.sqlite.close();
        } catch (error) {
            errors.push(error as Error);
        }

        try {
            await this.storage.memory.close();
        } catch (error) {
            errors.push(error as Error);
        }

        try {
            await this.storage.chroma.close();
        } catch (error) {
            errors.push(error as Error);
        }

        // Cleanup event listeners
        try {
            this.storage.memory.removeAllListeners();
        } catch (error) {
            errors.push(error as Error);
        }

        if (errors.length > 0) {
            console.warn('[AceEngine] Some resources failed to close:', errors);
        }

        console.log('AceEngine stopped');
    }

    registerTool(tool: any) {
        const taskLayer = this.layers.find(l => l.id === AceLayerID.TASK_PROSECUTION) as TaskProsecutionLayer;
        if (taskLayer) {
            taskLayer.registerTool(tool);
        } else {
            console.error('TaskProsecutionLayer not found');
        }
    }

    /**
     * Get the state of a specific layer
     * @param layerId The ID of the layer to query
     * @returns Layer state object or null if layer not found
     */
    getLayerState(layerId: AceLayerID): any {
        const layer = this.layers.find(l => l.id === layerId);
        if (!layer) return null;

        // Return layer-specific state if available
        if (layerId === AceLayerID.COGNITIVE_CONTROL) {
            const cognitiveLayer = layer as CognitiveControlLayer;
            return {
                focusState: cognitiveLayer.getFocusState(),
                ...this.storage.sqlite.getLayerState(layerId)
            };
        }

        // Get general state from SQLite
        return this.storage.sqlite.getLayerState(layerId);
    }

    /**
     * Get the cognitive control layer state
     * @returns FocusState enum value or null if layer not found
     */
    getCognitiveControlState() {
        const layer = this.layers.find(l => l.id === AceLayerID.COGNITIVE_CONTROL) as CognitiveControlLayer;
        return layer?.getFocusState() || null;
    }
}
