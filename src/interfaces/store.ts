/**
 * ACE Engine Core - 存储接口定义
 * @version 1.0.0
 */

import { Rule, Trajectory, DeltaLog } from '../types';

/**
 * 向量存储接口 (对应 ChromaDB)
 */
export interface IVectorStore {
    /**
     * 搜索相关规则
     * @param query 查询文本
     * @param limit 返回数量限制
     * @returns 相关规则列表
     */
    search(query: string, limit: number): Promise<Rule[]>;

    /**
     * 添加规则
     * @param rules 规则列表
     */
    add(rules: Omit<Rule, 'score'>[]): Promise<void>;

    /**
     * 更新规则
     * @param id 规则 ID
     * @param content 新内容 (可选)
     * @param metadata 元数据更新 (可选)
     */
    update(
        id: string,
        content?: string,
        metadata?: Partial<Rule['metadata']>
    ): Promise<void>;

    /**
     * 删除规则
     * @param ids 规则 ID 列表
     */
    delete(ids: string[]): Promise<void>;
}

/**
 * 轨迹存储接口 (对应 SQLite)
 */
export interface ITrajectoryStore {
    /**
     * 初始化存储 (建表)
     */
    init(): void;

    /**
     * 保存任务轨迹
     * @param trajectory 轨迹对象
     */
    saveTrajectory(trajectory: Trajectory): void;

    /**
     * 获取任务轨迹
     * @param id 任务 ID
     * @returns 轨迹对象或 null
     */
    getTrajectory(id: string): Trajectory | null;

    /**
     * 记录 Delta 日志
     * @param delta Delta 对象
     */
    logDelta(delta: DeltaLog): void;

    /**
     * 更新轨迹的进化状态
     * @param taskId 任务 ID
     * @param status 新状态
     */
    updateEvolutionStatus(
        taskId: string,
        status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
    ): void;

    /**
     * 获取数据库文件路径 (用于 DuckDB 挂载)
     * @returns 数据库文件绝对路径
     */
    getDbPath(): string;

    /**
     * 关闭数据库连接
     */
    close(): void;
}

/**
 * 分析引擎接口 (对应 DuckDB)
 */
export interface IAnalysisEngine {
    /**
     * 连接到 SQLite 数据库 (零拷贝挂载)
     * @param sqlitePath SQLite 数据库文件路径
     */
    connect(sqlitePath: string): Promise<void>;

    /**
     * 执行分析查询
     * @param query SQL 查询语句
     * @param params 查询参数
     * @returns 查询结果
     */
    query<T = unknown>(query: string, params?: unknown[]): Promise<T[]>;

    /**
     * 关闭连接
     */
    close(): Promise<void>;
}
