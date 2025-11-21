
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
                input_schema TEXT,
                is_active BOOLEAN DEFAULT 1,
                risk_level INTEGER DEFAULT 3,
                permissions TEXT,
                layer_id TEXT
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

        // Create indexes for common query patterns
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_layer_state_layer_id ON layer_state(layer_id);
            CREATE INDEX IF NOT EXISTS idx_capabilities_tool_name ON capabilities(tool_name);
            CREATE INDEX IF NOT EXISTS idx_capabilities_is_active ON capabilities(is_active);
            CREATE INDEX IF NOT EXISTS idx_active_goals_status ON active_goals(status);
            CREATE INDEX IF NOT EXISTS idx_active_goals_parent_strategy_id ON active_goals(parent_strategy_id);
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

    registerCapability(toolName: string, description: string, schema: any, riskLevel: number, permissions?: string, layerId?: string) {
        this.db.prepare(`
            INSERT INTO capabilities (tool_name, description, input_schema, risk_level, permissions, layer_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(tool_name) DO UPDATE SET
                description = excluded.description,
                input_schema = excluded.input_schema,
                risk_level = excluded.risk_level,
                permissions = excluded.permissions,
                layer_id = excluded.layer_id
        `).run(toolName, description, JSON.stringify(schema), riskLevel, permissions || null, layerId || null);
    }

    getActiveGoals() {
        return this.db.prepare('SELECT * FROM active_goals WHERE status = ?').all('active');
    }

    addGoal(goalId: string, description: string, parentStrategyId?: string) {
        this.db.prepare(`
            INSERT INTO active_goals (goal_id, description, progress, parent_strategy_id, status)
            VALUES (?, ?, 0.0, ?, 'active')
            ON CONFLICT(goal_id) DO UPDATE SET
                description = excluded.description,
                parent_strategy_id = excluded.parent_strategy_id
        `).run(goalId, description, parentStrategyId || null);
    }

    updateGoalProgress(goalId: string, progress: number) {
        this.db.prepare(`
            UPDATE active_goals 
            SET progress = ?
            WHERE goal_id = ?
        `).run(progress, goalId);
    }

    close() {
        this.db.close();
    }
}
