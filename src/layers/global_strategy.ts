
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';

export class GlobalStrategyLayer extends BaseLayer {

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM) {
        super(AceLayerID.GLOBAL_STRATEGY, bus, storage, llm);
    }

    async handleSouthbound(packet: SouthboundPacket) {
        // Acquire layer lock for concurrent safety
        const lockAcquired = await this.storage.memory.acquireLayerLock(this.id);
        if (!lockAcquired) {
            console.warn(`[${this.id}] Layer is locked, queuing packet ${packet.id}`);
            return;
        }

        try {
            // Check for empty content
            if (!packet.content || packet.content.trim() === '') {
                console.warn(`[${this.id}] Received empty content, ignoring packet ${packet.id} (traceId: ${packet.traceId})`);
                return;
            }

            if (packet.targetLayer === this.id) {
            // Handle reflection cycle trigger
            if (packet.type === SouthboundType.CONTROL && packet.content === 'REFLECTION_CYCLE_START') {
                console.log('[GlobalStrategy] Reflection cycle triggered - performing self-assessment');
                await this.performReflection();
                return;
            }

            console.log(`[GlobalStrategy] Processing directive: ${packet.content}`);

            // 1. Contextualize
            const context = await this.contextualize(packet);

            // 2. Generate Strategy
            const strategy = await this.generateStrategy(packet, context);

            // 3. Store active goals from strategy
            const goals = this.extractGoalsFromStrategy(strategy, packet.id);
            for (const goal of goals) {
                this.storage.sqlite.addGoal(goal.id, goal.description, packet.id);
            }

            // 4. Publish Strategy to Agent Model
            await this.bus.publishSouthbound({
                ...packet,
                type: SouthboundType.STRATEGY,
                sourceLayer: this.id,
                targetLayer: AceLayerID.AGENT_MODEL,
                content: strategy,
                parameters: { original_directive: packet.id }
            });
        }
        } finally {
            // Release lock
            await this.storage.memory.releaseLayerLock(this.id);
        }
    }

    async handleNorthbound(packet: NorthboundPacket) {
        // Check for empty summary
        if (!packet.summary || packet.summary.trim() === '') {
            console.warn(`[${this.id}] Received empty summary, ignoring packet ${packet.id} (traceId: ${packet.traceId})`);
            return;
        }

        // Log telemetry
        await this.storage.duckdb.logTelemetry(packet);

        // Handle FRUSTRATION_SIGNAL from Cognitive Control
        if (packet.type === NorthboundType.FRUSTRATION_SIGNAL) {
            console.warn(`[GlobalStrategy] FRUSTRATION_SIGNAL received: ${packet.summary}`);

            // Query recent logs for meta-cognitive analysis
            try {
                const recentLogs = await this.storage.duckdb.query(
                    "SELECT * FROM telemetry_log ORDER BY ts DESC LIMIT 50"
                );
                
            // Query failure patterns - Fix operator precedence with parentheses
            const failureAnalysis = await this.storage.duckdb.query(`
                SELECT 
                    source,
                    COUNT(*) as failure_count
                FROM telemetry_log
                WHERE (summary LIKE '%FAILURE%' OR summary LIKE '%failure%') AND ts > NOW() - INTERVAL '1 hour'
                GROUP BY source
                ORDER BY failure_count DESC
            `);

                console.log('[GlobalStrategy] Frustration analysis:', {
                    recentLogsCount: recentLogs.length,
                    failurePatterns: failureAnalysis
                });

                // Trigger re-planning or strategy adjustment
                // This could involve publishing a new PLAN or updating active_goals
                // For now, we log the analysis and could trigger a replanning request
            } catch (e) {
                console.error('[GlobalStrategy] Failed to query recent logs:', e);
            }
        }
    }

    private async contextualize(packet: SouthboundPacket): Promise<string> {
        // Query relevant episodic memories
        const queryResponse = await this.storage.chroma.queryEpisodic(packet.content, 3);
        const memories = queryResponse.documents[0] || [];

        // Query recent telemetry from DuckDB, especially failure records
        let recentFailures = '';
        try {
            const failureLogs = await this.storage.duckdb.query(
                "SELECT * FROM telemetry_log WHERE summary LIKE '%FAILURE%' OR summary LIKE '%failure%' ORDER BY ts DESC LIMIT 5"
            );
            if (failureLogs && failureLogs.length > 0) {
                recentFailures = '\n\nRecent Failures:\n' + failureLogs.map((log: any) => 
                    `- ${log.summary || 'Unknown failure'} (${log.ts || 'unknown time'})`
                ).join('\n');
            }
        } catch (e) {
            console.warn('[GlobalStrategy] Failed to query DuckDB for recent failures:', e);
        }

        return `
Relevant Memories:
${memories.join('\n')}
${recentFailures}

Directive:
${packet.content}
        `;
    }

    private async generateStrategy(_packet: SouthboundPacket, context: string): Promise<string> {
        const prompt = `
You are the Global Strategy Layer of the ACE Agent.
Based on the following context, generate a high-level strategy (list of milestones) to achieve the directive.

Context:
${context}

Output the strategy as a numbered list of milestones.
        `;

        return await this.llm.generate(prompt);
    }

    private extractGoalsFromStrategy(strategy: string, strategyId: string): Array<{ id: string; description: string }> {
        // Extract goals from strategy text (numbered list format)
        const lines = strategy.split('\n');
        const goals: Array<{ id: string; description: string }> = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Match numbered list items (e.g., "1. Goal description" or "1) Goal description")
            const match = line.match(/^\d+[\.\)]\s*(.+)$/);
            if (match) {
                goals.push({
                    id: `goal_${strategyId}_${i}`,
                    description: match[1]
                });
            }
        }
        
        return goals;
    }

    private async performReflection() {
        try {
            // Query recent telemetry for meta-cognitive analysis
            const recentLogs = await this.storage.duckdb.query(
                "SELECT * FROM telemetry_log ORDER BY ts DESC LIMIT 50"
            );

            // Query failure rates - Calculate percentage of records per source in last 24 hours
            // Use a subquery to ensure accurate percentage calculation
            const failureAnalysis = await this.storage.duckdb.query(`
                SELECT 
                    source,
                    COUNT(*) as count,
                    COUNT(*) * 100.0 / (
                        SELECT COUNT(*) 
                        FROM telemetry_log 
                        WHERE ts > NOW() - INTERVAL '24 hours'
                    ) as percentage
                FROM telemetry_log
                WHERE ts > NOW() - INTERVAL '24 hours'
                GROUP BY source
            `);

            // Query active goals progress
            const activeGoals = this.storage.sqlite.getActiveGoals();

                // Update goal progress based on recent activity
                for (const goal of activeGoals) {
                    // Simple progress calculation based on recent successful operations
                    const goalRelatedLogs = recentLogs.filter((log: any) => 
                        log.summary && log.summary.toLowerCase().includes(goal.description.toLowerCase().substring(0, 20))
                    );
                    const successCount = goalRelatedLogs.filter((log: any) => 
                        log.summary && (log.summary.includes('RESULT') || log.summary.includes('SUCCESS'))
                    ).length;
                    const totalCount = goalRelatedLogs.length;
                    const progress = totalCount > 0 ? Math.min(successCount / totalCount, 1.0) : 0;
                    
                    this.storage.sqlite.updateGoalProgress(goal.goal_id, progress);
                }

                console.log('[GlobalStrategy] Reflection analysis:', {
                    recentLogsCount: recentLogs.length,
                    failureAnalysis,
                    activeGoalsCount: activeGoals.length,
                    goalsUpdated: activeGoals.length
                });

            // Perform self-assessment and adjust strategy if needed
            // This could trigger goal updates or strategy refinement
        } catch (e) {
            console.error('[GlobalStrategy] Reflection cycle failed:', e);
        }
    }
}
