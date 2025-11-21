
import { Database } from 'duckdb-async';
import { NorthboundPacket, SouthboundPacket } from '../types';

export class DuckDBStorage {
    private db: Database | null = null;

    async connect(dbPath: string) {
        this.db = await Database.create(dbPath);
        await this.init();
    }

    private async init() {
        if (!this.db) throw new Error("DuckDB not connected");

        // Telemetry Log (Northbound) - Added embedding_id
        await this.db.run(`
            CREATE TABLE IF NOT EXISTS telemetry_log (
                id UUID PRIMARY KEY,
                layer_id VARCHAR,
                type VARCHAR,
                content TEXT,
                data JSON,
                embedding_id VARCHAR,
                timestamp TIMESTAMP
            );
        `);

        // Directives Log (Southbound) - Added status
        await this.db.run(`
            CREATE TABLE IF NOT EXISTS directives_log (
                id UUID PRIMARY KEY,
                source_layer VARCHAR,
                target_layer VARCHAR,
                type VARCHAR,
                content TEXT,
                status VARCHAR,
                timestamp TIMESTAMP
            );
        `);

        // Metrics
        await this.db.run(`
            CREATE TABLE IF NOT EXISTS metrics (
                name VARCHAR,
                value DOUBLE,
                tags JSON,
                timestamp TIMESTAMP
            );
        `);
    }

    async logTelemetry(packet: NorthboundPacket) {
        if (!this.db) return;

        const redactedData = this.redact(packet.data);

        await this.db.run(`
            INSERT INTO telemetry_log (id, layer_id, type, content, data, embedding_id, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            packet.id,
            packet.sourceLayer,
            packet.type,
            packet.summary,
            JSON.stringify(redactedData),
            (packet as any).embeddingId || null, // Assuming embeddingId might be added to packet or handled separately
            new Date()
        ]);
    }

    async logDirective(packet: SouthboundPacket) {
        if (!this.db) return;
        await this.db.run(`
            INSERT INTO directives_log (id, source_layer, target_layer, type, content, status, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            packet.id,
            packet.sourceLayer,
            packet.targetLayer,
            packet.type,
            packet.content,
            'PENDING', // Default status
            new Date()
        ]);
    }

    private redact(data: any): any {
        if (!data) return data;
        if (typeof data !== 'object') return data;

        const copy = JSON.parse(JSON.stringify(data));
        const SENSITIVE_KEYS = ['apiKey', 'password', 'token', 'secret'];

        const redactRecursive = (obj: any) => {
            for (const key in obj) {
                if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
                    obj[key] = '[REDACTED]';
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    redactRecursive(obj[key]);
                }
            }
        };

        redactRecursive(copy);
        return copy;
    }

    async run(query: string, params: any[] = []) {
        if (!this.db) throw new Error("DuckDB not connected");
        return await this.db.run(query, params);
    }

    async close() {
        if (this.db) {
            await this.db.close();
        }
    }
}
