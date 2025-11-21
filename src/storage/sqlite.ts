
import Database from 'better-sqlite3';
import path from 'path';

export class SQLiteStorage {
    private db: Database.Database;

    constructor(dbPath: string) {
        const resolvedPath = path.resolve(dbPath);
        this.db = new Database(resolvedPath);
        this.db.pragma('journal_mode = WAL');
        this.init();
    }

    private init() {
        // layer_state
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS layer_state (
                layer_id TEXT PRIMARY KEY,
                status TEXT,
                last_heartbeat INTEGER,
                config_json TEXT
            )
        `);

        // capabilities
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS capabilities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_name TEXT NOT NULL UNIQUE,
                description TEXT,
                input_schema JSON,
                is_active BOOLEAN DEFAULT 1,
                risk_level INTEGER
            )
        `);

        // active_goals
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS active_goals (
                goal_id TEXT PRIMARY KEY,
                description TEXT,
                progress REAL,
                parent_strategy_id TEXT,
                status TEXT
            )
        `);

        // kv_store
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);
    }

    getLayerState(layerId: string) {
        const row = this.db.prepare('SELECT * FROM layer_state WHERE layer_id = ?').get(layerId) as any;
        if (row) {
            return {
                ...row,
                config: JSON.parse(row.config_json)
            };
        }
        return null;
    }

    setLayerState(layerId: string, status: string, config: any) {
        this.db.prepare(`
            INSERT INTO layer_state (layer_id, status, last_heartbeat, config_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(layer_id) DO UPDATE SET
                status = excluded.status,
                last_heartbeat = excluded.last_heartbeat,
                config_json = excluded.config_json
        `).run(layerId, status, Date.now(), JSON.stringify(config));
    }

    getCapabilities() {
        return this.db.prepare('SELECT * FROM capabilities WHERE is_active = 1').all();
    }

    registerCapability(toolName: string, description: string, schema: any, riskLevel: number) {
        this.db.prepare(`
            INSERT INTO capabilities (tool_name, description, input_schema, risk_level)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(tool_name) DO UPDATE SET
                description = excluded.description,
                input_schema = excluded.input_schema,
                risk_level = excluded.risk_level
        `).run(toolName, description, JSON.stringify(schema), riskLevel);
    }

    close() {
        this.db.close();
    }
}
