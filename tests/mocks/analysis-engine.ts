import { IAnalysisEngine } from '../../src/interfaces/store';

/**
 * Mock Analysis Engine for Testing
 * 模拟 DuckDB 分析引擎的行为
 */
export class MockAnalysisEngine implements IAnalysisEngine {
    private data: Map<string, any[]> = new Map();
    private connected: boolean = false;

    async connect(_sqlitePath: string): Promise<void> {
        this.connected = true;
    }

    async query<T = unknown>(query: string, params: unknown[] = []): Promise<T[]> {
        if (!this.connected) {
            throw new Error('Not connected');
        }

        // 简化的模拟实现
        // 根据查询类型返回不同的模拟数据

        // 检查是否是查询 delta_logs
        if (query.includes('delta_logs')) {
            const deltaLogs = this.data.get('delta_logs') || [];

            // 如果有时间戳过滤
            if (params.length > 0 && query.includes('timestamp')) {
                const cutoff = params[0] as number;
                return deltaLogs.filter((log: any) => log.timestamp > cutoff) as T[];
            }

            return deltaLogs as T[];
        }

        // 检查是否是查询 trajectories
        if (query.includes('trajectories')) {
            // 特殊处理 runElimination 中的 unnest 查询
            if (query.includes('unnest')) {
                const trajectories = this.data.get('trajectories') || [];
                let filtered = trajectories;

                if (params.length > 0 && query.includes('timestamp')) {
                    const cutoff = params[0] as number;
                    filtered = trajectories.filter((t: any) => t.timestamp > cutoff);
                }

                // 提取所有 used_rule_ids
                const ruleIds = new Set<string>();
                for (const t of filtered) {
                    try {
                        const ids = JSON.parse(t.used_rule_ids);
                        if (Array.isArray(ids)) {
                            ids.forEach(id => ruleIds.add(id));
                        }
                    } catch (e) {
                        // ignore
                    }
                }

                return Array.from(ruleIds).map(id => ({ rule_id: id })) as T[];
            }

            const trajectories = this.data.get('trajectories') || [];

            if (params.length > 0 && query.includes('timestamp')) {
                const cutoff = params[0] as number;
                return trajectories.filter((t: any) => t.timestamp > cutoff) as T[];
            }

            return trajectories as T[];
        }

        return [] as T[];
    }

    async close(): Promise<void> {
        this.connected = false;
    }

    // 用于测试的辅助方法
    setMockData(table: string, data: any[]) {
        this.data.set(table, data);
    }

    clearMockData() {
        this.data.clear();
    }
}
