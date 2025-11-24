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
        // Existing tables (layer_state, capabilities, active_goals, kv_store, sessions, session_goals)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS layer_state (
                layer_id TEXT PRIMARY KEY,
                status TEXT,
                last_heartbeat INTEGER,
                config_json TEXT
            );
        `);
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
            );
        `);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS active_goals (
                goal_id TEXT PRIMARY KEY,
                description TEXT,
                progress REAL,
                parent_strategy_id TEXT,
                status TEXT
            );
        `);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                last_activity_at INTEGER NOT NULL,
                active_goals TEXT DEFAULT '[]',
                reflection_count INTEGER DEFAULT 0,
                last_reflection_time INTEGER DEFAULT 0,
                last_reflection_data_hash TEXT DEFAULT '',
                status TEXT DEFAULT 'active',
                metadata TEXT DEFAULT '{}'
            );
        `);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS session_goals (
                session_id TEXT NOT NULL,
                goal_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (session_id, goal_id),
                FOREIGN KEY (goal_id) REFERENCES active_goals(goal_id) ON DELETE CASCADE
            );
        `);
        // Telemetry and directives tables (replacing DuckDB functionality)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS telemetry_log (
                ts INTEGER,
                trace_id TEXT,
                source TEXT,
                summary TEXT,
                embedding_id TEXT,
                session_id TEXT
            );
        `);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS directives_log (
                ts INTEGER,
                trace_id TEXT,
                source TEXT,
                command TEXT,
                status TEXT,
                session_id TEXT
            );
        `);
        // Indexes for fast queries
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry_log(session_id);
            CREATE INDEX IF NOT EXISTS idx_directives_session ON directives_log(session_id);
        `);
        // Existing indexes for other tables (unchanged)
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_layer_state_layer_id ON layer_state(layer_id);
            CREATE INDEX IF NOT EXISTS idx_capabilities_tool_name ON capabilities(tool_name);
            CREATE INDEX IF NOT EXISTS idx_capabilities_is_active ON capabilities(is_active);
            CREATE INDEX IF NOT EXISTS idx_active_goals_status ON active_goals(status);
            CREATE INDEX IF NOT EXISTS idx_active_goals_parent_strategy_id ON active_goals(parent_strategy_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
            CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity_at);
            CREATE INDEX IF NOT EXISTS idx_session_goals_session_id ON session_goals(session_id);
            CREATE INDEX IF NOT EXISTS idx_session_goals_goal_id ON session_goals(goal_id);
        `);
    }

    // ---------- Existing layer / capability / session APIs (unchanged) ----------
    getLayerState(layerId: string) {
        const row = this.db.prepare('SELECT * FROM layer_state WHERE layer_id = ?').get(layerId) as any;
        if (row) {
            return { ...row, config: JSON.parse(row.config_json) };
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

    // ---------- Session management (unchanged) ----------
    createSession(sessionId: string, metadata?: Record<string, any>) {
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO sessions (
                session_id, created_at, last_activity_at, active_goals,
                reflection_count, last_reflection_time, last_reflection_data_hash, status, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            sessionId,
            now,
            now,
            JSON.stringify([]),
            0,
            0,
            '',
            'active',
            JSON.stringify(metadata || {})
        );
    }

    getSession(sessionId: string): any {
        const row = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as any;
        if (!row) return null;
        return {
            sessionId: row.session_id,
            createdAt: row.created_at,
            lastActivityAt: row.last_activity_at,
            activeGoals: JSON.parse(row.active_goals || '[]'),
            reflectionCount: row.reflection_count,
            lastReflectionTime: row.last_reflection_time,
            lastReflectionDataHash: row.last_reflection_data_hash || '',
            status: row.status as 'active' | 'idle' | 'completed' | 'archived',
            metadata: JSON.parse(row.metadata || '{}')
        };
    }

    updateSession(session: {
        sessionId: string;
        lastActivityAt?: number;
        activeGoals?: string[];
        reflectionCount?: number;
        lastReflectionTime?: number;
        lastReflectionDataHash?: string;
        status?: 'active' | 'idle' | 'completed' | 'archived';
        metadata?: Record<string, any>;
    }) {
        const existing = this.getSession(session.sessionId);
        if (!existing) return;
        const updates: string[] = [];
        const values: any[] = [];
        if (session.lastActivityAt !== undefined) { updates.push('last_activity_at = ?'); values.push(session.lastActivityAt); }
        if (session.activeGoals !== undefined) { updates.push('active_goals = ?'); values.push(JSON.stringify(session.activeGoals)); }
        if (session.reflectionCount !== undefined) { updates.push('reflection_count = ?'); values.push(session.reflectionCount); }
        if (session.lastReflectionTime !== undefined) { updates.push('last_reflection_time = ?'); values.push(session.lastReflectionTime); }
        if (session.lastReflectionDataHash !== undefined) { updates.push('last_reflection_data_hash = ?'); values.push(session.lastReflectionDataHash); }
        if (session.status !== undefined) { updates.push('status = ?'); values.push(session.status); }
        if (session.metadata !== undefined) { updates.push('metadata = ?'); values.push(JSON.stringify(session.metadata)); }
        if (updates.length > 0) {
            values.push(session.sessionId);
            this.db.prepare(`
                UPDATE sessions SET ${updates.join(', ')} WHERE session_id = ?
            `).run(...values);
        }
    }

    getActiveSessions(cutoffTime: number = Date.now() - 60 * 60 * 1000): string[] {
        const rows = this.db.prepare(`
            SELECT session_id FROM sessions
            WHERE status = 'active' AND last_activity_at > ?
            ORDER BY last_activity_at DESC
        `).all(cutoffTime) as Array<{ session_id: string }>;
        return rows.map(r => r.session_id);
    }

    getAllUnarchivedSessions(): string[] {
        const rows = this.db.prepare(`
            SELECT session_id FROM sessions
            WHERE status != 'archived'
            ORDER BY last_activity_at DESC
        `).all() as Array<{ session_id: string }>;
        return rows.map(r => r.session_id);
    }

    addGoalForSession(goalId: string, description: string, sessionId: string, parentStrategyId?: string): void {
        this.addGoal(goalId, description, parentStrategyId);
        this.db.prepare(`
            INSERT OR IGNORE INTO session_goals (session_id, goal_id, created_at)
            VALUES (?, ?, ?)
        `).run(sessionId, goalId, Date.now());
        const session = this.getSession(sessionId);
        if (session && !session.activeGoals.includes(goalId)) {
            session.activeGoals.push(goalId);
            this.updateSession({ sessionId, activeGoals: session.activeGoals });
        }
    }

    getActiveGoalsForSession(sessionId: string): any[] {
        return this.db.prepare(`
            SELECT g.* FROM active_goals g
            INNER JOIN session_goals sg ON g.goal_id = sg.goal_id
            WHERE sg.session_id = ? AND g.status = 'active'
        `).all(sessionId);
    }

    removeGoalFromSession(sessionId: string, goalId: string): void {
        this.db.prepare(`
            DELETE FROM session_goals WHERE session_id = ? AND goal_id = ?
        `).run(sessionId, goalId);
        const session = this.getSession(sessionId);
        if (session) {
            session.activeGoals = session.activeGoals.filter((id: string) => id !== goalId);
            this.updateSession({ sessionId, activeGoals: session.activeGoals });
        }
    }

    // ---------- Telemetry & Directive logging (new) ----------
    async logTelemetry(packet: any): Promise<void> {
        this.db.prepare(`
            INSERT INTO telemetry_log (ts, trace_id, source, summary, embedding_id, session_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            Date.now(),
            packet.traceId || '',
            packet.sourceLayer || '',
            packet.summary || '',
            (packet as any).embeddingId || null,
            packet.sessionId || null
        );
    }

    async logDirective(packet: any): Promise<void> {
        this.db.prepare(`
            INSERT INTO directives_log (ts, trace_id, source, command, status, session_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            Date.now(),
            packet.traceId || '',
            packet.sourceLayer || '',
            packet.content || '',
            'PENDING',
            packet.sessionId || null
        );
    }

    async getTelemetryBySession(sessionId: string, limit: number = 100): Promise<any[]> {
        return this.db.prepare(`
            SELECT * FROM telemetry_log
            WHERE session_id = ?
            ORDER BY ts DESC
            LIMIT ?
        `).all(sessionId, limit);
    }

    async getDirectivesBySession(sessionId: string, limit: number = 100): Promise<any[]> {
        return this.db.prepare(`
            SELECT * FROM directives_log
            WHERE session_id = ?
            ORDER BY ts DESC
            LIMIT ?
        `).all(sessionId, limit);
    }

    // Generic query / run helpers (kept for compatibility)
    async run(sql: string, params: any[] = []): Promise<void> {
        this.db.prepare(sql).run(...params);
    }

    async query(sql: string, params: any[] = []): Promise<any[]> {
        return this.db.prepare(sql).all(...params);
    }

    close() {
        this.db.close();
    }
}
