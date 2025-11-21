import { AceEngineConfig, BaseLLM, AceLayerID } from './types';
import { BusManager, BusDirection } from './core/bus';
import { SQLiteStorage } from './storage/sqlite';
import { DuckDBStorage } from './storage/duckdb';
import { ChromaStorage } from './storage/chroma';
import { MemoryStorage } from './storage/memory';
import { BaseLayer, AceStorages } from './layers/base';

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
        this.config = config;
        this.bus = new BusManager();

        // Initialize Storage
        this.storage = {
            sqlite: new SQLiteStorage(config.storage.sqlitePath),
            duckdb: new DuckDBStorage(),
            chroma: new ChromaStorage(config.memory.endpoint, config.memory.collectionPrefix),
            memory: new MemoryStorage(config.cache)
        };

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

        // Initialize Scheduler
        this.scheduler = new CognitiveScheduler(this.bus);

        // Initialize Layers
        const llmDriver = config.llm.driver as BaseLLM;

        this.layers = [
            new AspirationalLayer(this.bus, this.storage, llmDriver),
            new GlobalStrategyLayer(this.bus, this.storage, llmDriver),
            new AgentModelLayer(this.bus, this.storage, llmDriver),
            new ExecutiveFunctionLayer(this.bus, this.storage, llmDriver),
            new CognitiveControlLayer(this.bus, this.storage, llmDriver),
            new TaskProsecutionLayer(this.bus, this.storage, llmDriver),
        ];

        this.setupMiddlewares();
    }

    private setupMiddlewares() {
        // Logging Middleware (Southbound)
        this.bus.use(BusDirection.SOUTHBOUND, async (packet, next) => {
            await this.storage.duckdb.logDirective(packet);
            await next();
        });

        // Logging Middleware (Northbound)
        this.bus.use(BusDirection.NORTHBOUND, async (packet, next) => {
            await this.storage.duckdb.logTelemetry(packet);
            await next();
        });
    }

    async start() {
        await this.storage.duckdb.connect(this.config.storage.duckdbPath);
        await this.storage.chroma.init();

        this.scheduler.start();

        console.log(`ACE Engine ${this.config.agentId} started.`);
    }

    async stop() {
        this.scheduler.stop();
        await this.storage.duckdb.close();
        this.storage.sqlite.close();
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
}
