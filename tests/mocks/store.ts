
import { IVectorStore, ITrajectoryStore } from '../../src/interfaces/store';
import { Rule, Trajectory, DeltaLog } from '../../src/types';

/**
 * In-Memory Vector Store for Testing
 */
export class InMemoryVectorStore implements IVectorStore {
    public rules: Map<string, Rule> = new Map();

    async search(query: string, limit: number): Promise<Rule[]> {
        // Simple keyword matching for mock search
        const results = Array.from(this.rules.values())
            .map(rule => ({
                ...rule,
                score: this.calculateScore(query, rule.content)
            }))
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, limit);

        return results;
    }

    async add(rules: Omit<Rule, 'score'>[]): Promise<void> {
        for (const rule of rules) {
            this.rules.set(rule.id, rule as Rule);
        }
    }

    async update(id: string, content?: string, metadata?: Partial<Rule['metadata']>): Promise<void> {
        const rule = this.rules.get(id);
        if (rule) {
            if (content) {
                rule.content = content;
            }
            if (metadata) {
                rule.metadata = { ...rule.metadata, ...metadata };
            }
            this.rules.set(id, rule);
        }
    }

    async delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            this.rules.delete(id);
        }
    }

    private calculateScore(query: string, content: string): number {
        // Mock similarity: 1.0 if exact match, 0.5 if includes, 0.0 otherwise
        if (content === query) return 1.0;
        if (content.includes(query) || query.includes(content)) return 0.5;
        return 0.1; // Default low score
    }
}

/**
 * In-Memory Transaction Store for Testing
 */
export class InMemoryTransactionStore implements ITrajectoryStore {
    public trajectories: Map<string, Trajectory> = new Map();
    public deltaLogs: DeltaLog[] = [];
    public evolutionStatuses: Map<string, string> = new Map();

    init(): void {
        // No-op
    }

    saveTrajectory(trajectory: Trajectory): void {
        this.trajectories.set(trajectory.task_id, trajectory);
        // Also index by task_id for easier lookup if needed, but interface uses id (uuid) usually
    }

    getTrajectory(id: string): Trajectory | null {
        return this.trajectories.get(id) || null;
    }

    logDelta(delta: DeltaLog): void {
        this.deltaLogs.push(delta);
    }

    updateEvolutionStatus(taskId: string, status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'): void {
        this.evolutionStatuses.set(taskId, status);
    }

    getDbPath(): string {
        return ':memory:';
    }

    close(): void {
        // No-op
    }
}
