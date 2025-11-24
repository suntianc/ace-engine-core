/**
 * 会话管理器实现
 */

import { SessionState, SessionManager } from '../types/session';
import { AceStorages } from '../layers/base';

export class SessionManagerImpl implements SessionManager {
    private storage: AceStorages;
    private sessionCache: Map<string, SessionState> = new Map();

    constructor(storage: AceStorages) {
        this.storage = storage;
    }

    async createSession(sessionId: string, metadata?: Record<string, any>): Promise<void> {
        const session: SessionState = {
            sessionId,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            activeGoals: [],
            reflectionCount: 0,
            lastReflectionTime: 0,
            lastReflectionDataHash: '',
            status: 'active',
            metadata: metadata || {}
        };

        // 存储到 SQLite
        this.storage.sqlite.createSession(sessionId, metadata);
        this.sessionCache.set(sessionId, session);
    }

    async getSession(sessionId: string): Promise<SessionState | null> {
        // 先查缓存
        if (this.sessionCache.has(sessionId)) {
            return this.sessionCache.get(sessionId)!;
        }

        // 查数据库
        const session = this.storage.sqlite.getSession(sessionId);
        if (session) {
            this.sessionCache.set(sessionId, session);
        }
        return session;
    }

    async updateSessionActivity(sessionId: string): Promise<void> {
        const session = await this.getSession(sessionId);
        if (session) {
            session.lastActivityAt = Date.now();
            session.status = 'active';
            this.storage.sqlite.updateSession({
                sessionId,
                lastActivityAt: session.lastActivityAt,
                status: session.status
            });
            this.sessionCache.set(sessionId, session);
        }
    }

    async getActiveSessions(cutoffTime?: number): Promise<string[]> {
        // 如果 cutoffTime 为 -1，返回所有未归档会话
        if (cutoffTime === -1) {
            return this.storage.sqlite.getAllUnarchivedSessions();
        }

        // 获取最近 1 小时内有活动的会话（默认）
        // 🐛 修复: 使用 ?? 代替 || 以正确处理 cutoffTime=0 的情况
        const defaultCutoffTime = cutoffTime ?? (Date.now() - 60 * 60 * 1000);
        return this.storage.sqlite.getActiveSessions(defaultCutoffTime);
    }

    async getAllUnarchivedSessions(): Promise<string[]> {
        // 获取所有未归档的会话（status != 'archived'）
        return this.storage.sqlite.getAllUnarchivedSessions();
    }

    async archiveSession(sessionId: string): Promise<void> {
        const session = await this.getSession(sessionId);
        if (session) {
            session.status = 'archived';
            this.storage.sqlite.updateSession({
                sessionId,
                status: session.status
            });
            this.sessionCache.delete(sessionId);
        }
    }

    async updateReflectionState(sessionId: string, dataHash: string): Promise<void> {
        const session = await this.getSession(sessionId);
        if (session) {
            session.lastReflectionTime = Date.now();
            session.lastReflectionDataHash = dataHash;
            session.reflectionCount++;
            this.storage.sqlite.updateSession({
                sessionId,
                lastReflectionTime: session.lastReflectionTime,
                lastReflectionDataHash: session.lastReflectionDataHash,
                reflectionCount: session.reflectionCount
            });
            this.sessionCache.set(sessionId, session);
        }
    }

    async addGoalToSession(sessionId: string, goalId: string): Promise<void> {
        const session = await this.getSession(sessionId);
        if (session && !session.activeGoals.includes(goalId)) {
            session.activeGoals.push(goalId);
            this.storage.sqlite.updateSession({
                sessionId,
                activeGoals: session.activeGoals
            });
            this.sessionCache.set(sessionId, session);
        }
    }

    async removeGoalFromSession(sessionId: string, goalId: string): Promise<void> {
        this.storage.sqlite.removeGoalFromSession(sessionId, goalId);
        const session = await this.getSession(sessionId);
        if (session) {
            this.sessionCache.set(sessionId, session);
        }
    }

    async clearSessionHistory(sessionId: string): Promise<void> {
        // 清理会话缓存
        this.sessionCache.delete(sessionId);
    }

    /**
     * 更新会话元数据（合并方式，不会覆盖现有字段）
     * @param sessionId 会话ID
     * @param metadata 要更新的元数据字段
     */
    async updateSessionMetadata(sessionId: string, metadata: Record<string, any>): Promise<void> {
        const session = await this.getSession(sessionId);
        if (session) {
            // 合并元数据（保留现有字段，更新新字段）
            const updatedMetadata = {
                ...(session.metadata || {}),
                ...metadata
            };

            session.metadata = updatedMetadata;
            this.storage.sqlite.updateSession({
                sessionId,
                metadata: updatedMetadata
            });
            this.sessionCache.set(sessionId, session);
        }
    }
}

