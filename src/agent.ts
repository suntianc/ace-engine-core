/**
 * AceAgent - ACE 引擎主调度器
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { BaseLLM, Trajectory } from './types';
import { IVectorStore, ITrajectoryStore, IAnalysisEngine } from './interfaces/store';
import { Generator } from './core/generator';
import { Reflector } from './core/reflector';
import { Curator } from './core/curator';

/**
 * AceAgent 配置
 */
export interface AceAgentConfig {
    /** LLM 实例 */
    llm: BaseLLM;

    /** 向量存储 */
    vectorStore: IVectorStore;

    /** 轨迹存储 */
    trajectoryStore: ITrajectoryStore;

    /** 分析引擎 (DuckDB) */
    analysisEngine: IAnalysisEngine;

    /** 反思策略 */
    reflectionStrategy?: 'always' | 'on_failure' | 'sampling';

    /** 采样率 (当 reflectionStrategy = 'sampling' 时) */
    samplingRate?: number;

    /** 检索规则数量 */
    retrievalLimit?: number;
}

/**
 * AceAgent - ACE 引擎核心类
 *
 * 事件：
 * - 'status': (status: string) => void - 状态更新
 * - 'reflected': (insight: Insight) => void - 反思完成
 * - 'evolved': (deltas: Delta[]) => void - 进化完成
 * - 'error': (error: Error) => void - 错误发生
 */
export class AceAgent extends EventEmitter {
    private generator: Generator;
    private reflector: Reflector;
    private curator: Curator;
    private trajectoryStore: ITrajectoryStore;
    private analysisEngine: IAnalysisEngine;

    private reflectionStrategy: 'always' | 'on_failure' | 'sampling';
    private samplingRate: number;

    constructor(config: AceAgentConfig) {
        super();

        this.trajectoryStore = config.trajectoryStore;
        this.analysisEngine = config.analysisEngine;
        this.reflectionStrategy = config.reflectionStrategy || 'always';
        this.samplingRate = config.samplingRate || 0.1;

        // 初始化组件
        this.generator = new Generator({
            llm: config.llm,
            vectorStore: config.vectorStore,
            retrievalLimit: config.retrievalLimit,
        });

        this.reflector = new Reflector({
            llm: config.llm,
        });

        this.curator = new Curator({
            llm: config.llm,
            vectorStore: config.vectorStore,
            trajectoryStore: config.trajectoryStore,
            analysisEngine: config.analysisEngine,
        });
    }

    /**
     * 运行任务 (主入口)
     * @param task 用户任务
     * @returns 执行结果
     */
    async run(task: string): Promise<string> {
        try {
            // 1. 检索相关规则
            const context = await this.generator.retrieveContext(task);

            // 2. 执行任务
            const { result, trajectory } = await this.generator.execute(task, context);

            // 3. 保存轨迹
            this.trajectoryStore.saveTrajectory(trajectory);

            // 4. 触发异步进化 (Fire and Forget)
            this.evolve(trajectory).catch((err) => this.emit('error', err));

            return result;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.emit('error', err);
            throw err;
        }
    }

    /**
     * 后台进化逻辑 (异步运行)
     */
    private async evolve(trajectory: Trajectory): Promise<void> {
        try {
            // 判断是否需要反思
            if (!this.shouldReflect(trajectory)) {
                this.trajectoryStore.updateEvolutionStatus(trajectory.task_id, 'COMPLETED');
                return;
            }

            // 更新状态为处理中
            this.trajectoryStore.updateEvolutionStatus(trajectory.task_id, 'PROCESSING');
            this.emit('status', 'reflecting');

            // 1. 反思
            const insight = await this.reflector.analyze(trajectory);
            this.emit('reflected', insight);

            // 2. 策展
            this.emit('status', 'curating');
            const deltas = await this.curator.processInsight(insight, trajectory.task_id);

            // 3. 应用更新
            if (deltas.length > 0) {
                await this.curator.applyDeltas(deltas, trajectory.task_id);
                this.emit('evolved', deltas);
            }

            // 更新状态为完成
            this.trajectoryStore.updateEvolutionStatus(trajectory.task_id, 'COMPLETED');
        } catch (error) {
            // 更新状态为失败
            this.trajectoryStore.updateEvolutionStatus(trajectory.task_id, 'FAILED');

            const err = error instanceof Error ? error : new Error(String(error));
            this.emit('error', err);
        }
    }

    /**
     * 判断是否应该进行反思
     */
    private shouldReflect(trajectory: Trajectory): boolean {
        switch (this.reflectionStrategy) {
            case 'always':
                return true;

            case 'on_failure':
                return trajectory.outcome === 'FAILURE';

            case 'sampling':
                if (trajectory.outcome === 'FAILURE') {
                    return true; // 失败任务总是反思
                }
                return Math.random() < this.samplingRate;

            default:
                return true;
        }
    }

    /**
     * 执行维护任务 (如清理长期未使用的规则)
     * 建议定期调用 (如每天一次)
     * @param daysUnused 未使用天数阈值，默认 30 天
     * @returns 删除的规则数量
     */
    async runMaintenance(daysUnused: number = 30): Promise<number> {
        try {
            this.emit('status', 'maintenance');
            const deletedCount = await this.curator.runElimination(daysUnused);
            return deletedCount;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.emit('error', err);
            throw err;
        }
    }

    /**
     * 关闭 Agent
     */
    async close(): Promise<void> {
        this.trajectoryStore.close();
        await this.analysisEngine.close();
        this.removeAllListeners();
    }
}
