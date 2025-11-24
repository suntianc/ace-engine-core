/**
 * 反思触发器核心引擎
 * 基于"惊奇度"与"偏差"的反思触发系统
 */

import { 
    ReflectionTriggerType, 
    ReflectionLevel, 
    ReflectionTrigger, 
    ReflectionTriggerConfig,
    StateComparison
} from '../types/reflection';
import { AceStorages } from '../layers/base';
import crypto from 'crypto';

export class ReflectionTriggerEngine {
    private config: ReflectionTriggerConfig;
    private cooldownMap: Map<string, number> = new Map(); // triggerType:sessionId -> cooldownUntil
    private actionHistory: Map<string, any[]> = new Map(); // sessionId -> actions
    private progressHistory: Map<string, Array<{ time: number, progress: number }>> = new Map(); // sessionId -> progress history

    constructor(_storage: AceStorages, config: ReflectionTriggerConfig = {}) {
        this.config = {
            predictionErrorThreshold: 0.3,
            loopDetectionWindow: 5,
            loopDetectionThreshold: 0.8,
            stagnationTimeWindow: 5 * 60 * 1000, // 5分钟
            stagnationProgressThreshold: 0.01,
            maxTokens: 100000,
            maxSteps: 100,
            maxTime: 30 * 60 * 1000, // 30分钟
            cooldownMs: 30 * 1000, // 30秒冷却
            contextWindowThreshold: 0.8,
            ...config
        };
    }

    /**
     * 1. 预测误差检测（最核心机制）
     */
    async checkPredictionError(
        traceId: string,
        expectedState: any,
        actualState: any,
        sessionId?: string
    ): Promise<ReflectionTrigger | null> {
        const comparison = this.compareStates(expectedState, actualState);
        const threshold = this.config.predictionErrorThreshold ?? 0.3;
        
        if (comparison.difference > threshold) {
            const trigger: ReflectionTrigger = {
                type: ReflectionTriggerType.PREDICTION_ERROR,
                level: this.determineReflectionLevel(comparison.difference),
                sessionId,
                traceId,
                context: {
                    expectedState,
                    actualState,
                    metrics: { difference: comparison.difference }
                },
                timestamp: Date.now()
            };

            if (await this.checkCooldown(trigger)) {
                return trigger;
            }
        }

        return null;
    }

    /**
     * 2. 循环检测（阻断性触发）
     */
    async checkLoopDetection(
        sessionId: string,
        currentAction: any
    ): Promise<ReflectionTrigger | null> {
        const history = this.actionHistory.get(sessionId) || [];
        
        if (history.length < this.config.loopDetectionWindow!) {
            history.push(currentAction);
            this.actionHistory.set(sessionId, history);
            return null;
        }

        // 检查最近 N 次行动是否相似
        const recentActions = history.slice(-this.config.loopDetectionWindow!);
        const similarity = this.calculateActionSimilarity(recentActions);

        if (similarity > this.config.loopDetectionThreshold!) {
            const trigger: ReflectionTrigger = {
                type: ReflectionTriggerType.LOOP_DETECTION,
                level: ReflectionLevel.STRATEGIC,
                sessionId,
                traceId: currentAction.traceId || crypto.randomUUID(),
                context: {
                    history: recentActions,
                    metrics: { similarity, loopLength: recentActions.length }
                },
                timestamp: Date.now()
            };

            if (await this.checkCooldown(trigger)) {
                // 清空历史，避免重复触发
                this.actionHistory.set(sessionId, []);
                return trigger;
            }
        }

        history.push(currentAction);
        // 保持历史窗口大小
        if (history.length > this.config.loopDetectionWindow! * 2) {
            history.shift();
        }
        this.actionHistory.set(sessionId, history);

        return null;
    }

    /**
     * 3. 停滞检测（绩效差距）
     */
    async checkStagnation(
        sessionId: string,
        goalProgress: number
    ): Promise<ReflectionTrigger | null> {
        const history = this.progressHistory.get(sessionId) || [];
        const now = Date.now();

        // 添加当前进度
        history.push({ time: now, progress: goalProgress });

        // 保持历史窗口（最近1小时）
        const cutoffTime = now - 60 * 60 * 1000;
        const recentHistory = history.filter(h => h.time > cutoffTime);
        this.progressHistory.set(sessionId, recentHistory);

        if (recentHistory.length < 2) {
            return null;
        }

        // 检查是否有进展
        const oldest = recentHistory[0];
        const newest = recentHistory[recentHistory.length - 1];
        const progressDelta = Math.abs(newest.progress - oldest.progress);
        const timeDelta = newest.time - oldest.time;

        const stagnationTimeWindow = this.config.stagnationTimeWindow ?? 5 * 60 * 1000;
        const stagnationProgressThreshold = this.config.stagnationProgressThreshold ?? 0.01;

        if (timeDelta > stagnationTimeWindow && 
            progressDelta < stagnationProgressThreshold) {
            const trigger: ReflectionTrigger = {
                type: ReflectionTriggerType.STAGNATION,
                level: ReflectionLevel.STRATEGIC,
                sessionId,
                traceId: crypto.randomUUID(),
                context: {
                    metrics: {
                        currentProgress: goalProgress,
                        progressDelta: progressDelta,
                        timeSinceLastProgress: timeDelta
                    }
                },
                timestamp: Date.now()
            };

            if (await this.checkCooldown(trigger)) {
                return trigger;
            }
        }

        return null;
    }

    /**
     * 4. 完结性触发
     */
    async checkCompletion(
        traceId: string,
        subgoalId: string,
        result: any,
        sessionId?: string
    ): Promise<ReflectionTrigger | null> {
        // 验证是否真的完成了
        const isValid = await this.validateCompletion(result);

        if (!isValid) {
            const trigger: ReflectionTrigger = {
                type: ReflectionTriggerType.COMPLETION,
                level: ReflectionLevel.LOCAL,
                sessionId,
                traceId,
                context: {
                    metrics: { validationFailed: 1 },
                    subgoalId: subgoalId,
                    result: result
                },
                timestamp: Date.now()
            };

            return trigger;
        }

        return null;
    }

    /**
     * 5. 累积性触发（上下文窗口即将填满）
     */
    async checkAccumulation(
        sessionId: string,
        contextWindowUsage: number
    ): Promise<ReflectionTrigger | null> {
        const threshold = this.config.contextWindowThreshold ?? 0.8;
        if (contextWindowUsage > threshold) {
            const trigger: ReflectionTrigger = {
                type: ReflectionTriggerType.ACCUMULATION,
                level: ReflectionLevel.STRATEGIC,
                sessionId,
                traceId: crypto.randomUUID(),
                context: {
                    metrics: {
                        contextWindowUsage,
                        threshold: threshold
                    }
                },
                timestamp: Date.now()
            };

            if (await this.checkCooldown(trigger)) {
                return trigger;
            }
        }

        return null;
    }

    /**
     * 6. 反馈性触发（外部反馈）
     */
    async checkFeedback(
        traceId: string,
        feedback: { type: 'positive' | 'negative', content: string },
        sessionId?: string
    ): Promise<ReflectionTrigger | null> {
        if (feedback.type === 'negative') {
            const trigger: ReflectionTrigger = {
                type: ReflectionTriggerType.FEEDBACK,
                level: ReflectionLevel.STRATEGIC,
                sessionId,
                traceId,
                context: {
                    feedback
                },
                timestamp: Date.now()
            };

            // 反馈触发不需要冷却
            return trigger;
        }

        return null;
    }

    /**
     * 7. 探索性触发（发现高价值信息）
     */
    async checkCuriosity(
        traceId: string,
        discovery: { value: number, content: string },
        sessionId?: string
    ): Promise<ReflectionTrigger | null> {
        const CURIOSITY_THRESHOLD = 0.7; // 高价值阈值

        if (discovery.value > CURIOSITY_THRESHOLD) {
            const trigger: ReflectionTrigger = {
                type: ReflectionTriggerType.CURIOSITY,
                level: ReflectionLevel.STRATEGIC,
                sessionId,
                traceId,
                context: {
                    discovery
                },
                timestamp: Date.now()
            };

            return trigger;
        }

        return null;
    }

    /**
     * 8. 资源耗尽检测
     */
    async checkResourceExhaustion(
        sessionId: string,
        metrics: { tokens: number, steps: number, time: number }
    ): Promise<ReflectionTrigger | null> {
        const triggers: ReflectionTrigger[] = [];
        const maxTokens = this.config.maxTokens ?? 100000;
        const maxSteps = this.config.maxSteps ?? 100;
        const maxTime = this.config.maxTime ?? 30 * 60 * 1000;

        if (metrics.tokens > maxTokens * 0.9) {
            triggers.push({
                type: ReflectionTriggerType.RESOURCE_EXHAUSTION,
                level: ReflectionLevel.STRATEGIC,
                sessionId,
                traceId: crypto.randomUUID(),
                context: { metrics: { tokens: metrics.tokens, limit: maxTokens } },
                timestamp: Date.now()
            });
        }

        if (metrics.steps > maxSteps * 0.9) {
            triggers.push({
                type: ReflectionTriggerType.RESOURCE_EXHAUSTION,
                level: ReflectionLevel.STRATEGIC,
                sessionId,
                traceId: crypto.randomUUID(),
                context: { metrics: { steps: metrics.steps, limit: maxSteps } },
                timestamp: Date.now()
            });
        }

        if (metrics.time > maxTime * 0.9) {
            triggers.push({
                type: ReflectionTriggerType.RESOURCE_EXHAUSTION,
                level: ReflectionLevel.STRATEGIC,
                sessionId,
                traceId: crypto.randomUUID(),
                context: { metrics: { time: metrics.time, limit: maxTime } },
                timestamp: Date.now()
            });
        }

        // 返回第一个触发的（如果存在）
        for (const trigger of triggers) {
            if (await this.checkCooldown(trigger)) {
                return trigger;
            }
        }

        return null;
    }

    // ========== 辅助方法 ==========

    /**
     * 状态对比
     */
    private compareStates(expected: any, actual: any): StateComparison {
        const fields: StateComparison['fields'] = [];
        let totalDifference = 0;
        let fieldCount = 0;

        const compare = (exp: any, act: any, path: string = '') => {
            if (typeof exp !== typeof act) {
                fields.push({
                    field: path,
                    expected: exp,
                    actual: act,
                    difference: 1.0
                });
                totalDifference += 1.0;
                fieldCount++;
                return;
            }

            if (typeof exp === 'object' && exp !== null && act !== null) {
                const keys = new Set([...Object.keys(exp), ...Object.keys(act)]);
                for (const key of keys) {
                    compare(exp[key], act[key], path ? `${path}.${key}` : key);
                }
            } else {
                const diff = exp === act ? 0 : 1;
                fields.push({
                    field: path,
                    expected: exp,
                    actual: act,
                    difference: diff
                });
                totalDifference += diff;
                fieldCount++;
            }
        };

        compare(expected, actual);

        return {
            expected,
            actual,
            difference: fieldCount > 0 ? totalDifference / fieldCount : 0,
            fields
        };
    }

    /**
     * 确定反思级别
     */
    private determineReflectionLevel(difference: number): ReflectionLevel {
        if (difference < 0.5) {
            return ReflectionLevel.LOCAL; // 小差异，局部处理
        } else if (difference < 0.8) {
            return ReflectionLevel.STRATEGIC; // 中等差异，策略修正
        } else {
            return ReflectionLevel.ASPIRATIONAL; // 大差异，目标重构
        }
    }

    /**
     * 计算行动相似度
     */
    private calculateActionSimilarity(actions: any[]): number {
        if (actions.length < 2) return 0;

        let similarCount = 0;
        for (let i = 1; i < actions.length; i++) {
            const prev = actions[i - 1];
            const curr = actions[i];
            
            if (prev.type === curr.type && 
                JSON.stringify(prev.params) === JSON.stringify(curr.params)) {
                similarCount++;
            }
        }

        return similarCount / (actions.length - 1);
    }

    /**
     * 检查冷却时间
     */
    private async checkCooldown(trigger: ReflectionTrigger): Promise<boolean> {
        const cooldownKey = `${trigger.type}:${trigger.sessionId || 'global'}`;
        const cooldownUntil = this.cooldownMap.get(cooldownKey) || 0;

        if (Date.now() < cooldownUntil) {
            console.log(`[ReflectionTrigger] Cooldown active for ${trigger.type}, skipping`);
            return false;
        }

        // 设置新的冷却时间
        const cooldownMs = this.config.cooldownMs ?? 30 * 1000;
        this.cooldownMap.set(
            cooldownKey,
            Date.now() + cooldownMs
        );

        return true;
    }

    /**
     * 验证完成状态
     */
    private async validateCompletion(result: any): Promise<boolean> {
        // 简化的验证逻辑
        return result && (result.status === 'success' || result.success === true);
    }

    /**
     * 清理会话历史（用于会话结束时）
     */
    clearSessionHistory(sessionId: string): void {
        this.actionHistory.delete(sessionId);
        this.progressHistory.delete(sessionId);
    }
}

