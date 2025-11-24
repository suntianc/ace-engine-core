
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM } from '../types';
import { BusManager } from '../core/bus';
import { SQLiteStorage } from '../storage/sqlite';
import { ChromaStorage } from '../storage/chroma';
import { MemoryStorage } from '../storage/memory';
import { SessionManager } from '../types/session';

export interface AceStorages {
    sqlite: SQLiteStorage;
    logs: SQLiteStorage;
    chroma: ChromaStorage;
    memory: MemoryStorage;
}

export abstract class BaseLayer {
    public readonly id: AceLayerID;
    protected bus: BusManager;
    protected storage: AceStorages;
    protected llm: BaseLLM;
    protected sessionManager?: SessionManager; // 可选的会话管理器
    protected maxContextWindow: number;

    constructor(
        id: AceLayerID,
        bus: BusManager,
        storage: AceStorages,
        llm: BaseLLM,
        sessionManager?: SessionManager,
        maxContextWindow?: number
    ) {

        this.id = id;
        this.bus = bus;
        this.storage = storage;
        this.llm = llm;
        this.sessionManager = sessionManager;
        this.maxContextWindow = maxContextWindow ?? 10;
        this.setupListeners();
    }

    protected setupListeners() {
        this.bus.southbound.on(this.id, this.handleSouthbound.bind(this));
        this.bus.northbound.on(this.id, this.handleNorthbound.bind(this));
    }

    protected abstract handleSouthbound(packet: SouthboundPacket): Promise<void>;
    protected abstract handleNorthbound(packet: NorthboundPacket): Promise<void>;
}
