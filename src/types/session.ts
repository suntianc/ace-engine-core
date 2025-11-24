/**
 * 会话管理类型定义
 */

/**
 * 会话状态
 */
export interface SessionState {
    sessionId: string;
    createdAt: number;
    lastActivityAt: number;
    activeGoals: string[];  // goal IDs
    reflectionCount: number;
    lastReflectionTime: number;
    lastReflectionDataHash: string;
    status: 'active' | 'idle' | 'completed' | 'archived';
    metadata?: Record<string, any>; // 扩展元数据
}

/**
 * 会话管理器接口
 */
export interface SessionManager {
    createSession(sessionId: string, metadata?: Record<string, any>): Promise<void>;
    getSession(sessionId: string): Promise<SessionState | null>;
    updateSessionActivity(sessionId: string): Promise<void>;
    getActiveSessions(cutoffTime?: number): Promise<string[]>;
    getAllUnarchivedSessions(): Promise<string[]>; // 获取所有未归档会话
    archiveSession(sessionId: string): Promise<void>;
    updateReflectionState(sessionId: string, dataHash: string): Promise<void>;
    addGoalToSession(sessionId: string, goalId: string): Promise<void>;
    removeGoalFromSession(sessionId: string, goalId: string): Promise<void>;
    clearSessionHistory(sessionId: string): Promise<void>;
    /**
     * 更新会话元数据（合并方式，不会覆盖现有字段）
     * @param sessionId 会话ID
     * @param metadata 要更新的元数据字段
     */
    updateSessionMetadata(sessionId: string, metadata: Record<string, any>): Promise<void>;
}

