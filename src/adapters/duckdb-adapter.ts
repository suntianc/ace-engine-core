/**
 * DuckDB 适配器 - 零拷贝分析引擎
 * @version 1.0.0
 */

import { Database } from 'duckdb-async';
import { IAnalysisEngine } from '../interfaces/store';

/**
 * DuckDB 适配器实现
 * 直接挂载 SQLite 数据库进行 OLAP 分析
 */
export class DuckDBAdapter implements IAnalysisEngine {
    private db: Database | null = null;
    private connected = false;

    /**
     * 连接到 SQLite 数据库 (零拷贝挂载)
     */
    async connect(sqlitePath: string): Promise<void> {
        // 创建内存数据库
        this.db = await Database.create(':memory:');

        // 安装并加载 SQLite 扩展
        await this.db.run('INSTALL sqlite');
        await this.db.run('LOAD sqlite');

        // 挂载 SQLite 数据库 (只读模式，避免锁冲突)
        await this.db.run(
            `CALL sqlite_attach('${sqlitePath}', alias => 'storage', read_only => true)`
        );

        this.connected = true;
    }

    /**
     * 执行分析查询
     */
    async query<T = unknown>(query: string, params: unknown[] = []): Promise<T[]> {
        if (!this.db || !this.connected) {
            throw new Error('DuckDB not connected. Call connect() first.');
        }

        // DuckDB 使用位置参数 $1, $2, ...
        // 替换 ? 为 $1, $2, ...
        let paramIndex = 1;
        const duckQuery = query.replace(/\?/g, () => `$${paramIndex++}`);

        const result = await this.db.all(duckQuery, ...params);
        return result as T[];
    }

    /**
     * 关闭连接
     */
    async close(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = null;
            this.connected = false;
        }
    }
}
