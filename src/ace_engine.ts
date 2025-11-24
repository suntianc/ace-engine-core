import { AceEngineConfig, BaseLLM, AceLayerID, SouthboundType } from './types';
import { BusManager } from './core/bus';
import { SQLiteStorage } from './storage/sqlite';
import { ChromaStorage } from './storage/chroma';
import { MemoryStorage } from './storage/memory';
import { BaseLayer, AceStorages } from './layers/base';
import { ConfigurationError, StorageError } from './utils/errors';
import crypto from 'crypto';

import { AspirationalLayer } from './layers/aspirational';
import { GlobalStrategyLayer } from './layers/global_strategy';
import { AgentModelLayer } from './layers/agent_model';
import { ExecutiveFunctionLayer } from './layers/executive_function';
import { CognitiveControlLayer, FocusState } from './layers/cognitive_control';
import { TaskProsecutionLayer } from './layers/task_prosecution';
import { CognitiveScheduler } from './core/scheduler';
import { SessionManagerImpl } from './core/session_manager';
import { SessionManager, SessionState } from './types/session';

export class AceEngine {
    public bus: BusManager;
    public storage: AceStorages;
    public sessionManager: SessionManager;
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
            logs: new SQLiteStorage(config.storage.logsPath),
            chroma: new ChromaStorage(config.memory.endpoint, config.memory.collectionPrefix),
            memory: new MemoryStorage(config.cache, config.contextWindow?.maxLength)
        };

        // Initialize BusManager with storage dependency for internal logging
        this.bus = new BusManager({ logs: this.storage.logs });

        // Initialize Session Manager
        this.sessionManager = new SessionManagerImpl(this.storage);

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

        // Initialize Scheduler (only heartbeat, reflection is trigger-based)
        this.scheduler = new CognitiveScheduler(
            this.bus,
            config.scheduler?.heartbeatIntervalMs
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

        // Initialize Layers with SessionManager
        this.layers = [
            new AspirationalLayer(this.bus, this.storage, getLLM(AceLayerID.ASPIRATIONAL), this.sessionManager),
            new GlobalStrategyLayer(this.bus, this.storage, getLLM(AceLayerID.GLOBAL_STRATEGY), this.sessionManager),
            new AgentModelLayer(this.bus, this.storage, getLLM(AceLayerID.AGENT_MODEL), this.sessionManager, undefined),
            new ExecutiveFunctionLayer(this.bus, this.storage, getLLM(AceLayerID.EXECUTIVE_FUNCTION), this.sessionManager),
            new CognitiveControlLayer(this.bus, this.storage, getLLM(AceLayerID.COGNITIVE_CONTROL), this.sessionManager),
            new TaskProsecutionLayer(this.bus, this.storage, getLLM(AceLayerID.TASK_PROSECUTION), this.sessionManager),
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
        if (!config.storage.logsPath || config.storage.logsPath.trim() === '') {
            throw new ConfigurationError('storage.logsPath is required');
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
            if (this.storage?.logs) {
                this.storage.logs.close();
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
            this.storage.logs.close();
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
    getCognitiveControlState(): FocusState | null {
        const layer = this.layers.find(l => l.id === AceLayerID.COGNITIVE_CONTROL) as CognitiveControlLayer;
        return layer?.getFocusState() || null;
    }

    // ========== 会话管理方法 ==========

    /**
     * 创建新会话
     * @param sessionId 会话ID
     * @param metadata 可选的会话元数据
     */
    async createSession(sessionId: string, metadata?: Record<string, any>): Promise<void> {
        await this.sessionManager.createSession(sessionId, metadata);
    }

    /**
     * 获取会话状态
     * @param sessionId 会话ID
     * @returns 会话状态或 null
     */
    async getSessionState(sessionId: string): Promise<SessionState | null> {
        return await this.sessionManager.getSession(sessionId);
    }

    /**
     * 更新会话活动时间
     * @param sessionId 会话ID
     */
    async updateSessionActivity(sessionId: string): Promise<void> {
        await this.sessionManager.updateSessionActivity(sessionId);
    }

    /**
     * 获取活动会话列表
     * @param cutoffTime 可选的时间截止点（毫秒时间戳），默认是1小时前；-1表示获取所有未归档会话
     * @returns 活动会话ID列表
     */
    async getActiveSessions(cutoffTime?: number): Promise<string[]> {
        return await this.sessionManager.getActiveSessions(cutoffTime);
    }

    /**
     * 获取所有未归档会话列表
     * @returns 所有未归档会话ID列表
     */
    async getAllUnarchivedSessions(): Promise<string[]> {
        return await this.sessionManager.getAllUnarchivedSessions();
    }

    /**
     * 归档会话
     * @param sessionId 会话ID
     */
    async archiveSession(sessionId: string): Promise<void> {
        await this.sessionManager.archiveSession(sessionId);
    }

    /**
     * 更新会话元数据（合并方式，不会覆盖现有字段）
     * @param sessionId 会话ID
     * @param metadata 要更新的元数据字段
     */
    async updateSessionMetadata(sessionId: string, metadata: Record<string, any>): Promise<void> {
        await this.sessionManager.updateSessionMetadata(sessionId, metadata);
    }

    /**
     * 查询会话的遥测日志
     * @param sessionId 会话ID
     * @param limit 限制返回数量，默认100
     * @returns 遥测日志列表
     */
    async getTelemetryBySession(sessionId: string, limit: number = 100): Promise<any[]> {
        return await this.storage.logs.getTelemetryBySession(sessionId, limit);
    }

    /**
     * 查询会话的指令日志
     * @param sessionId 会话ID
     * @param limit 限制返回数量，默认100
     * @returns 指令日志列表
     */
    async getDirectivesBySession(sessionId: string, limit: number = 100): Promise<any[]> {
        return await this.storage.logs.getDirectivesBySession(sessionId, limit);
    }

    /**
     * 发布带会话ID的消息（便捷方法）
     * @param sessionId 会话ID
     * @param content 消息内容
     * @param targetLayer 目标层级
     */
    async publishWithSession(
        sessionId: string,
        content: string,
        targetLayer: AceLayerID
    ): Promise<void> {
        // 更新会话活动时间
        await this.updateSessionActivity(sessionId);

        await this.bus.publishSouthbound({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            traceId: crypto.randomUUID(),
            sessionId: sessionId,
            sourceLayer: AceLayerID.ASPIRATIONAL,
            targetLayer: targetLayer,
            type: SouthboundType.IMPERATIVE,
            content: content
        });
    }
}
