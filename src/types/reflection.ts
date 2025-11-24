/**
 * 反思触发机制类型定义
 * 基于"惊奇度"与"偏差"的反思触发系统
 */

/**
 * 反思触发类型
 */
export enum ReflectionTriggerType {
    // 基于预测误差
    PREDICTION_ERROR = 'PREDICTION_ERROR',
    
    // 基于绩效差距
    PERFORMANCE_GAP = 'PERFORMANCE_GAP',
    LOOP_DETECTION = 'LOOP_DETECTION',
    STAGNATION = 'STAGNATION',
    RESOURCE_EXHAUSTION = 'RESOURCE_EXHAUSTION',
    
    // 五种具体触发器
    COMPLETION = 'COMPLETION',
    BLOCKAGE = 'BLOCKAGE',
    ACCUMULATION = 'ACCUMULATION',
    FEEDBACK = 'FEEDBACK',
    CURIOSITY = 'CURIOSITY',
    
    // 安全与伦理
    SAFETY_VIOLATION = 'SAFETY_VIOLATION',
    ALIGNMENT_VIOLATION = 'ALIGNMENT_VIOLATION',
    
    // 周期性（已废弃，保留用于兼容）
    PERIODIC = 'PERIODIC'
}

/**
 * 反思级别（对应 ACE 层级）
 */
export enum ReflectionLevel {
    LOCAL = 'LOCAL',           // L1: 执行层 - 局部重试
    STRATEGIC = 'STRATEGIC',   // L2: 策略层 - 策略修正
    ASPIRATIONAL = 'ASPIRATIONAL' // L3: 愿景层 - 目标重构
}

/**
 * 反思触发配置
 */
export interface ReflectionTriggerConfig {
    // 预测误差阈值
    predictionErrorThreshold?: number;
    
    // 循环检测配置
    loopDetectionWindow?: number;      // 检测窗口大小
    loopDetectionThreshold?: number;   // 相似度阈值
    
    // 停滞检测配置
    stagnationTimeWindow?: number;     // 时间窗口（毫秒）
    stagnationProgressThreshold?: number; // 进度变化阈值
    
    // 资源耗尽阈值
    maxTokens?: number;
    maxSteps?: number;
    maxTime?: number;
    
    // Cooldown 配置
    cooldownMs?: number;               // 冷却时间（毫秒）
    
    // 上下文窗口阈值
    contextWindowThreshold?: number;  // 触发记忆压缩的阈值
}

/**
 * 反思触发结果
 */
export interface ReflectionTrigger {
    type: ReflectionTriggerType;
    level: ReflectionLevel;
    sessionId?: string;
    traceId: string;
    context: {
        expectedState?: any;
        actualState?: any;
        error?: any;
        history?: any[];
        metrics?: Record<string, number>;
        feedback?: { type: 'positive' | 'negative', content: string };
        discovery?: { value: number, content: string };
        subgoalId?: string;
        result?: any;
    };
    timestamp: number;
    cooldownUntil?: number;  // 冷却到期时间
}

/**
 * 预期状态 vs 实际状态
 */
export interface StateComparison {
    expected: any;
    actual: any;
    difference: number;  // 差异度（0-1）
    fields: Array<{
        field: string;
        expected: any;
        actual: any;
        difference: number;
    }>;
}

