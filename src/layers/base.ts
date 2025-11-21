
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM } from '../types';
import { BusManager } from '../core/bus';
import { SQLiteStorage } from '../storage/sqlite';
import { DuckDBStorage } from '../storage/duckdb';
import { ChromaStorage } from '../storage/chroma';
import { MemoryStorage } from '../storage/memory';

export interface AceStorages {
    sqlite: SQLiteStorage;
    duckdb: DuckDBStorage;
    chroma: ChromaStorage;
    memory: MemoryStorage;
}

export abstract class BaseLayer {
    public readonly id: AceLayerID;
    protected bus: BusManager;
    protected storage: AceStorages;
    protected llm: BaseLLM;

    constructor(id: AceLayerID, bus: BusManager, storage: AceStorages, llm: BaseLLM) {
        this.id = id;
        this.bus = bus;
        this.storage = storage;
        this.llm = llm;
        this.setupListeners();
    }

    protected setupListeners() {
        this.bus.southbound.on(this.id, this.handleSouthbound.bind(this));
        this.bus.northbound.on(this.id, this.handleNorthbound.bind(this));
    }

    protected abstract handleSouthbound(packet: SouthboundPacket): Promise<void>;
    protected abstract handleNorthbound(packet: NorthboundPacket): Promise<void>;
}
