
import { Database } from 'duckdb-async';
import { NorthboundPacket, SouthboundPacket } from '../types';
import { StorageError } from '../utils/errors';

export class DuckDBStorage {
    private db: Database | null = null;
    private telemetryBuffer: NorthboundPacket[] = [];
    private directiveBuffer: SouthboundPacket[] = [];
    private flushInterval: NodeJS.Timeout | null = null;
    private readonly BATCH_SIZE = 100;
    private readonly FLUSH_INTERVAL_MS = 5000; // 5 seconds

    async connect(dbPath: string) {
        this.db = await Database.create(dbPath);
        await this.init();
    }

    private async init() {
        if (!this.db) throw new StorageError("DuckDB not connected");

        // Telemetry Log (Northbound) - Schema per design document: ts, trace_id, source, summary, embedding_id
        // Use CREATE TABLE IF NOT EXISTS to preserve historical data
        await this.db.run(`
            CREATE TABLE IF NOT EXISTS telemetry_log (
                ts TIMESTAMP,
                trace_id VARCHAR,
                source VARCHAR,
                summary TEXT,
                embedding_id VARCHAR
            );
        `);

        // Directives Log (Southbound) - Schema per design document: ts, trace_id, source, command, status
        await this.db.run(`
            CREATE TABLE IF NOT EXISTS directives_log (
                ts TIMESTAMP,
                trace_id VARCHAR,
                source VARCHAR,
                command TEXT,
                status VARCHAR
            );
        `);

        // Metrics - Schema per design document: ts, layer, metric_name, value
        await this.db.run(`
            CREATE TABLE IF NOT EXISTS metrics (
                ts TIMESTAMP,
                layer VARCHAR,
                metric_name VARCHAR,
                value DOUBLE
            );
        `);

        // Create indexes for common query patterns
        await this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_telemetry_log_ts ON telemetry_log(ts);
            CREATE INDEX IF NOT EXISTS idx_telemetry_log_source ON telemetry_log(source);
            CREATE INDEX IF NOT EXISTS idx_telemetry_log_trace_id ON telemetry_log(trace_id);
            CREATE INDEX IF NOT EXISTS idx_directives_log_ts ON directives_log(ts);
            CREATE INDEX IF NOT EXISTS idx_directives_log_source ON directives_log(source);
            CREATE INDEX IF NOT EXISTS idx_directives_log_trace_id ON directives_log(trace_id);
            CREATE INDEX IF NOT EXISTS idx_directives_log_status ON directives_log(status);
            CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts);
            CREATE INDEX IF NOT EXISTS idx_metrics_layer ON metrics(layer);
        `);
    }

    async logTelemetry(packet: NorthboundPacket) {
        if (!this.db) return;

        // Add to buffer
        this.telemetryBuffer.push(packet);

        // Flush if buffer is full
        if (this.telemetryBuffer.length >= this.BATCH_SIZE) {
            await this.flushTelemetry();
        }

        // Start flush interval if not already started
        if (!this.flushInterval) {
            this.flushInterval = setInterval(() => {
                this.flushTelemetry().catch(err => {
                    console.error('[DuckDBStorage] Failed to flush telemetry:', err);
                });
            }, this.FLUSH_INTERVAL_MS);
        }
    }

    async logDirective(packet: SouthboundPacket) {
        if (!this.db) return;

        // Add to buffer
        this.directiveBuffer.push(packet);

        // Flush if buffer is full
        if (this.directiveBuffer.length >= this.BATCH_SIZE) {
            await this.flushDirectives();
        }

        // Start flush interval if not already started (shared with telemetry)
        if (!this.flushInterval) {
            this.flushInterval = setInterval(async () => {
                await Promise.all([
                    this.flushTelemetry().catch(err => {
                        console.error('[DuckDBStorage] Failed to flush telemetry:', err);
                    }),
                    this.flushDirectives().catch(err => {
                        console.error('[DuckDBStorage] Failed to flush directives:', err);
                    })
                ]);
            }, this.FLUSH_INTERVAL_MS);
        }
    }

    private redact(data: any): any {
        if (!data) return data;
        
        // Handle string data (like summary)
        if (typeof data === 'string') {
            const SENSITIVE_PATTERNS = [
                /api[_-]?key[\s=:]+([^\s\n]+)/gi,
                /password[\s=:]+([^\s\n]+)/gi,
                /token[\s=:]+([^\s\n]+)/gi,
                /secret[\s=:]+([^\s\n]+)/gi
            ];
            
            let redacted = data;
            for (const pattern of SENSITIVE_PATTERNS) {
                redacted = redacted.replace(pattern, (match, value) => {
                    return match.replace(value, '[REDACTED]');
                });
            }
            return redacted;
        }
        
        // Handle object data
        if (typeof data === 'object') {
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
        
        return data;
    }

    async run(sql: string, params: any[] = []) {
        if (!this.db) throw new StorageError("DuckDB not connected");
        await this.db.run(sql, ...params);
    }

    async query(sql: string, params: any[] = []): Promise<any[]> {
        if (!this.db) throw new StorageError("DuckDB not connected");
        return await this.db.all(sql, ...params);
    }

    private async flushTelemetry(): Promise<void> {
        if (this.telemetryBuffer.length === 0 || !this.db) return;

        const packets = this.telemetryBuffer.splice(0, this.BATCH_SIZE);
        
        try {
            // Batch insert using parameterized queries
            for (const packet of packets) {
                const redactedSummary = this.redact(packet.summary);
                await this.db.run(`
                    INSERT INTO telemetry_log (ts, trace_id, source, summary, embedding_id)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    new Date(),
                    packet.traceId,
                    packet.sourceLayer,
                    redactedSummary,
                    (packet as any).embeddingId || null
                ]);
            }
        } catch (error) {
            console.error('[DuckDBStorage] Failed to flush telemetry buffer:', error);
            // Re-add packets to buffer for retry (optional, could also log to error queue)
        }
    }

    private async flushDirectives(): Promise<void> {
        if (this.directiveBuffer.length === 0 || !this.db) return;

        const packets = this.directiveBuffer.splice(0, this.BATCH_SIZE);
        
        try {
            // Batch insert
            for (const packet of packets) {
                await this.db.run(`
                    INSERT INTO directives_log (ts, trace_id, source, command, status)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    new Date(),
                    packet.traceId,
                    packet.sourceLayer,
                    packet.content,
                    'PENDING' // Default status
                ]);
            }
        } catch (error) {
            console.error('[DuckDBStorage] Failed to flush directives buffer:', error);
            // Re-add packets to buffer for retry (optional)
        }
    }

    async close() {
        // Clear flush interval
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }

        // Flush remaining buffers
        await Promise.all([
            this.flushTelemetry(),
            this.flushDirectives()
        ]);

        if (this.db) {
            await this.db.close();
        }
    }
}
