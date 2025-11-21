
/**
 * ACE Engine Core - Type Definitions
 * Based on the Ultimate Detailed Design
 */

import { z } from 'zod';

// --- Enums ---

export enum AceLayerID {
    ASPIRATIONAL = 'ASPIRATIONAL',
    GLOBAL_STRATEGY = 'GLOBAL_STRATEGY',
    AGENT_MODEL = 'AGENT_MODEL',
    EXECUTIVE_FUNCTION = 'EXECUTIVE_FUNCTION',
    COGNITIVE_CONTROL = 'COGNITIVE_CONTROL',
    TASK_PROSECUTION = 'TASK_PROSECUTION',
}

export enum SouthboundType {
    IMPERATIVE = 'IMPERATIVE',
    STRATEGY = 'STRATEGY',
    PLAN = 'PLAN',
    INSTRUCTION = 'INSTRUCTION',
    CONTROL = 'CONTROL',
    VETO = 'VETO',
}

export enum NorthboundType {
    OBSERVATION = 'OBSERVATION',
    RESULT = 'RESULT',
    STATUS = 'STATUS',
    FAILURE = 'FAILURE',
    CRITICAL_FAILURE = 'CRITICAL_FAILURE',
    EPIPHANY = 'EPIPHANY',
    FRUSTRATION_SIGNAL = 'FRUSTRATION_SIGNAL',
    CAPABILITY_ERROR = 'CAPABILITY_ERROR',
}

// --- Interfaces ---

export interface SouthboundPacket {
    id: string;               // UUID
    timestamp: number;        // Unix Timestamp
    traceId: string;          // Trace ID

    sourceLayer: AceLayerID;
    targetLayer: AceLayerID;

    type: SouthboundType;

    content: string;          // Natural language instruction

    parameters?: Record<string, any>; // Structured parameters
}

export interface NorthboundPacket {
    id: string;
    timestamp: number;
    traceId: string;

    sourceLayer: AceLayerID;
    targetLayer: AceLayerID;

    type: NorthboundType;

    summary: string;          // Natural language summary

    data?: any;               // Raw data payload
}

// --- Configuration ---

export interface AceStorageConfig {
    mode: 'composite';
    sqlitePath: string;
    duckdbPath: string;
}

export interface AceCacheConfig {
    type: 'redis' | 'memory';
    redisUrl?: string; // Required when type === 'redis', optional when type === 'memory'
}

export interface AceMemoryConfig {
    provider: 'chroma';
    endpoint: string;
    collectionPrefix: string;
}

export interface AceLLMConfig {
    driver: BaseLLM;
    modelMap?: Record<string, string>; // Optional: if not provided, all layers use default driver
}

export interface AceSchedulerConfig {
    heartbeatIntervalMs?: number; // Default: 1000ms
    reflectionIntervalMs?: number; // Default: 5 minutes
}

export interface AceContextWindowConfig {
    maxLength?: number; // Default: 10
}

export interface AceEngineConfig {
    agentId: string;
    storage: AceStorageConfig;
    cache: AceCacheConfig;
    memory: AceMemoryConfig;
    llm: AceLLMConfig;
    scheduler?: AceSchedulerConfig; // Optional scheduler configuration
    contextWindow?: AceContextWindowConfig; // Optional context window configuration
}

// --- Tool Registry ---

export interface AceTool {
    name: string;
    description: string;
    execute: (params: any) => Promise<any>;
    schema: z.ZodType<any>; // Zod schema
}

// --- Legacy Types (Generator/Reflector/Curator) ---

/**
 * 战术手册中的单条规则 (The Atom of Memory)
 */
export interface Rule {
    /** 规则唯一标识 (UUID) */
    id: string;

    /** 规则文本内容 */
    content: string;

    /** 向量数据 (由向量数据库处理，可选) */
    embedding?: number[];

    /** 元数据 */
    metadata: {
        /** 创建时间戳 */
        created_at: number;

        /** 最后使用时间戳 */
        last_used_at: number;

        /** 成功次数 */
        success_count: number;

        /** 失败次数 */
        failure_count: number;

        /** 来源任务 ID */
        source_task_id?: string;

        /** 扩展字段 */
        [key: string]: unknown;
    };

    /** 搜索时的相似度分数 (可选) */
    score?: number;
}

/**
 * 任务执行的单个步骤
 */
export interface TaskStep {
    /** 思考过程 */
    thought: string;

    /** 执行的动作 */
    action: string;

    /** 动作输出 */
    output: string;
}

/**
 * 完整轨迹 (The Raw Experience)
 */
export interface Trajectory {
    /** 任务唯一标识 */
    task_id: string;

    /** 用户原始输入 */
    user_input: string;

    /** 执行步骤 */
    steps: TaskStep[];

    /** 最终结果 */
    final_result: string;

    /** 环境反馈 (报错信息或用户反馈) */
    environment_feedback: string;

    /** 任务结果 */
    outcome: 'SUCCESS' | 'FAILURE';

    /** 本次任务引用的规则 ID 列表 */
    used_rule_ids: string[];

    /** 时间戳 */
    timestamp: number;

    /** 耗时 (毫秒) */
    duration_ms: number;

    /** 进化状态 */
    evolution_status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

/**
 * 增量更新包 (The Git Commit)
 */
export interface Delta {
    /** 操作类型 */
    type: 'ADD' | 'UPDATE' | 'DELETE' | 'MERGE';

    /** 规则 ID (UPDATE/DELETE 时必需) */
    rule_id?: string;

    /** 规则内容 (ADD/UPDATE 时必需) */
    content?: string;

    /** Reflector 的原始反思文本 */
    reasoning: string;

    /** 变更详情 */
    change_payload?: Record<string, unknown>;
}

/**
 * Delta 日志记录
 */
export interface DeltaLog {
    /** 自增 ID */
    id?: number;

    /** 关联的规则 ID */
    rule_id: string | null;

    /** 操作类型 */
    action_type: 'ADD' | 'UPDATE' | 'DELETE' | 'MERGE';

    /** 推理文本 */
    reasoning: string;

    /** 变更载荷 (JSON) */
    change_payload: Record<string, unknown>;

    /** 触发此更新的任务 ID */
    triggered_by_task_id: string;

    /** 时间戳 */
    timestamp: number;
}

/**
 * Reflector 的反思输出
 */
export interface Insight {
    /** 结果分析 */
    outcome_analysis: string;

    /** 责任归属 */
    blame_assignment: {
        /** 问题类型 */
        type: 'missing_knowledge' | 'bad_rule' | 'hallucination' | 'external_error';

        /** 问题规则 ID (如果是旧规则误导) */
        culprit_rule_id: string | null;

        /** 新见解 */
        new_insight: string;
    };
}

/**
 * LLM 提供者接口
 */
export interface BaseLLM {
    /**
     * 生成文本
     * @param prompt 提示词
     * @returns 生成的文本
     */
    generate(prompt: string): Promise<string>;

    /**
     * 生成结构化输出 (JSON)
     * @param prompt 提示词
     * @param schema Zod schema
     * @returns 解析后的对象
     */
    generateStructured<T>(prompt: string, schema: unknown): Promise<T>;
}
