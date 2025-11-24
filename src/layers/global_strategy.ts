
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';
import { ReflectionTriggerEngine } from '../core/reflection_trigger';
import { SessionManager } from '../types/session';

export class GlobalStrategyLayer extends BaseLayer {
    private reflectionTrigger: ReflectionTriggerEngine;

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM, sessionManager?: SessionManager) {
        super(AceLayerID.GLOBAL_STRATEGY, bus, storage, llm, sessionManager);
        this.reflectionTrigger = new ReflectionTriggerEngine(storage);
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

            // 🆕 更新会话活动时间（如果有 sessionId）
            if (packet.sessionId && this.sessionManager) {
                await this.sessionManager.updateSessionActivity(packet.sessionId);
            }

            if (packet.targetLayer === this.id) {
                // 定时反思已移除，现在由基于惊奇度的触发器驱动
                // 如果收到 REFLECTION_CYCLE_START，忽略它（向后兼容）
                if (packet.type === SouthboundType.CONTROL && packet.content === 'REFLECTION_CYCLE_START') {
                    console.log('[GlobalStrategy] Periodic reflection disabled, using trigger-based reflection instead');
                    return;
                }

                console.log(`[GlobalStrategy] Processing directive: ${packet.content}`);

                // 1. Contextualize
                const context = await this.contextualize(packet);

                // 2. Generate Strategy
                const strategy = await this.generateStrategy(packet, context);

                // 3. Store active goals from strategy (会话级别)
                const goals = this.extractGoalsFromStrategy(strategy, packet.id);
                const sessionId = packet.sessionId;

                for (const goal of goals) {
                    if (sessionId) {
                        // 会话级别的目标存储
                        this.storage.sqlite.addGoalForSession(
                            goal.id,
                            goal.description,
                            sessionId,
                            packet.id
                        );
                    } else {
                        // 兼容旧代码：全局目标
                        this.storage.sqlite.addGoal(goal.id, goal.description, packet.id);
                    }
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
        await this.storage.logs.logTelemetry(packet);

        // Handle reflection triggers from lower layers
        if (packet.data?.trigger) {
            const trigger = packet.data.trigger;
            console.log(`[GlobalStrategy] Reflection trigger received: ${trigger.type}`);
            await this.handleReflectionTrigger(trigger, packet);
            return;
        }

        // Handle FRUSTRATION_SIGNAL from Cognitive Control
        if (packet.type === NorthboundType.FRUSTRATION_SIGNAL) {
            console.warn(`[GlobalStrategy] FRUSTRATION_SIGNAL received: ${packet.summary}`);
            await this.handleFrustrationSignal(packet);
        }

        // Check for accumulation and stagnation triggers
        if (packet.sessionId) {
            await this.checkReflectionTriggers(packet.sessionId);
        }
    }

    /**
     * 检查反思触发器（累积性和停滞检测）
     */
    private async checkReflectionTriggers(sessionId: string) {
        try {
            // 1. 检查累积性触发（上下文窗口）
            const contextWindowUsage = await this.getContextWindowUsage(sessionId);
            const accumulation = await this.reflectionTrigger.checkAccumulation(
                sessionId,
                contextWindowUsage
            );

            if (accumulation) {
                console.log(`[GlobalStrategy] Accumulation trigger: context window usage ${contextWindowUsage}`);
                await this.compressMemory(sessionId);
            }

            // 2. 检查停滞检测（会话级别）
            const activeGoals = sessionId
                ? await this.storage.sqlite.getActiveGoalsForSession(sessionId)
                : this.storage.sqlite.getActiveGoals();

            if (activeGoals.length > 0) {
                const goalProgress = activeGoals.reduce((sum: number, goal: any) =>
                    sum + (goal.progress || 0), 0) / activeGoals.length;

                const stagnation = await this.reflectionTrigger.checkStagnation(
                    sessionId,
                    goalProgress
                );

                if (stagnation) {
                    console.log(`[GlobalStrategy] Stagnation trigger detected for session ${sessionId}`);
                    await this.handleReflectionTrigger(stagnation, {
                        sessionId: sessionId,
                        traceId: stagnation.traceId
                    } as NorthboundPacket);
                }
            }
        } catch (e) {
            console.error('[GlobalStrategy] Error checking reflection triggers:', e);
        }
    }

    /**
     * 处理反思触发器
     */
    private async handleReflectionTrigger(trigger: any, _packet: NorthboundPacket) {
        console.log(`[GlobalStrategy] Handling reflection trigger: ${trigger.type}`);

        try {
            // 执行策略调整
            await this.performStrategyReflection(trigger, _packet);
        } catch (e) {
            console.error('[GlobalStrategy] Error handling reflection trigger:', e);
        }
    }

    /**
     * 执行策略反思
     */
    private async performStrategyReflection(trigger: any, _packet: NorthboundPacket) {
        const sessionId = _packet.sessionId || trigger.sessionId;

        // 查询相关数据（会话级别）
        const recentLogs = await this.storage.logs.query(
            sessionId
                ? `SELECT * FROM telemetry_log WHERE session_id = ? ORDER BY ts DESC LIMIT 50`
                : `SELECT * FROM telemetry_log ORDER BY ts DESC LIMIT 50`,
            sessionId ? [sessionId] : []
        );

        // 获取会话级别的目标（如果提供了 sessionId）
        const activeGoals = sessionId
            ? await this.storage.sqlite.getActiveGoalsForSession(sessionId)
            : this.storage.sqlite.getActiveGoals();

        // 根据触发器类型执行不同的反思逻辑
        switch (trigger.type) {
            case 'LOOP_DETECTION':
                // 检测到循环，需要调整策略
                console.log('[GlobalStrategy] Loop detected, adjusting strategy');
                // 可以触发重新规划
                break;
            case 'STAGNATION':
                // 停滞检测，需要优化策略
                console.log('[GlobalStrategy] Stagnation detected, optimizing strategy');
                break;
            case 'ACCUMULATION':
                // 上下文窗口满，压缩记忆
                console.log('[GlobalStrategy] Context window full, compressing memory');
                break;
            default:
                console.log(`[GlobalStrategy] Handling reflection trigger: ${trigger.type}`);
        }

        // 更新目标进度
        for (const goal of activeGoals) {
            const goalData = goal as { goal_id: string; description: string; progress: number };
            const goalRelatedLogs = recentLogs.filter((log: any) =>
                log.summary && log.summary.toLowerCase().includes(goalData.description.toLowerCase().substring(0, 20))
            );
            const successCount = goalRelatedLogs.filter((log: any) =>
                log.summary && (log.summary.includes('RESULT') || log.summary.includes('SUCCESS'))
            ).length;
            const totalCount = goalRelatedLogs.length;
            const progress = totalCount > 0 ? Math.min(successCount / totalCount, 1.0) : 0;

            this.storage.sqlite.updateGoalProgress(goalData.goal_id, progress);
        }

        console.log('[GlobalStrategy] Strategy reflection completed:', {
            triggerType: trigger.type,
            recentLogsCount: recentLogs.length,
            activeGoalsCount: activeGoals.length
        });
    }

    /**
     * 处理挫折信号
     */
    private async handleFrustrationSignal(_packet: NorthboundPacket) {
        try {
            const recentLogs = await this.storage.logs.query(
                "SELECT * FROM telemetry_log ORDER BY ts DESC LIMIT 50"
            );

            const failureAnalysis = await this.storage.logs.query(`
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
        } catch (e) {
            console.error('[GlobalStrategy] Failed to query recent logs:', e);
        }
    }

    /**
     * 获取上下文窗口使用率
     */
    private async getContextWindowUsage(sessionId: string): Promise<number> {
        try {
            const contextWindow = await this.storage.memory.get(`context_window:${sessionId}`);
            if (!contextWindow) return 0;

            const list = JSON.parse(contextWindow);
            return list.length / this.maxContextWindow;
        } catch {
            return 0;
        }
    }

    /**
     * 压缩记忆
     */
    private async compressMemory(sessionId: string) {
        console.log(`[GlobalStrategy] Compressing memory for session ${sessionId}`);
        // 实现记忆压缩逻辑
        // 可以将上下文窗口的内容向量化并存入长期记忆
    }

    private async contextualize(packet: SouthboundPacket): Promise<string> {
        // Query relevant episodic memories
        const queryResponse = await this.storage.chroma.queryEpisodic(packet.content, 3);
        const memories = queryResponse.documents[0] || [];

        // Query recent telemetry from DuckDB, especially failure records
        let recentFailures = '';
        try {
            const failureLogs = await this.storage.logs.query(
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

    // performReflection 方法已移除，现在使用 handleReflectionTrigger 和 performStrategyReflection
}
