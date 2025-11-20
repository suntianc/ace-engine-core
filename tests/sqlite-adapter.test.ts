/**
 * SQLite 适配器测试
 */

import { SQLiteAdapter } from '../src/adapters/sqlite-adapter';
import { Trajectory } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

describe('SQLiteAdapter', () => {
    let adapter: SQLiteAdapter;
    const testDbPath = path.join(__dirname, 'test.db');

    beforeEach(() => {
        // 清理旧的测试数据库
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        if (fs.existsSync(`${testDbPath}-shm`)) {
            fs.unlinkSync(`${testDbPath}-shm`);
        }
        if (fs.existsSync(`${testDbPath}-wal`)) {
            fs.unlinkSync(`${testDbPath}-wal`);
        }

        adapter = new SQLiteAdapter(testDbPath);
        adapter.init();
    });

    afterEach(() => {
        adapter.close();

        // 清理测试文件
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        if (fs.existsSync(`${testDbPath}-shm`)) {
            fs.unlinkSync(`${testDbPath}-shm`);
        }
        if (fs.existsSync(`${testDbPath}-wal`)) {
            fs.unlinkSync(`${testDbPath}-wal`);
        }
    });

    describe('init', () => {
        it('应该创建必需的表', () => {
            // 通过尝试插入数据来验证表的存在
            const trajectory: Trajectory = {
                task_id: 'test-1',
                user_input: 'test input',
                steps: [],
                final_result: 'test result',
                environment_feedback: '',
                outcome: 'SUCCESS',
                used_rule_ids: [],
                timestamp: Date.now(),
                duration_ms: 100,
            };

            expect(() => adapter.saveTrajectory(trajectory)).not.toThrow();
        });
    });

    describe('saveTrajectory', () => {
        it('应该成功保存轨迹', () => {
            const trajectory: Trajectory = {
                task_id: 'test-1',
                user_input: 'test input',
                steps: [
                    {
                        thought: 'test thought',
                        action: 'test action',
                        output: 'test output',
                    },
                ],
                final_result: 'test result',
                environment_feedback: '',
                outcome: 'SUCCESS',
                used_rule_ids: ['rule-1'],
                timestamp: Date.now(),
                duration_ms: 100,
            };

            adapter.saveTrajectory(trajectory);

            const retrieved = adapter.getTrajectory('test-1');
            expect(retrieved).not.toBeNull();
            expect(retrieved?.task_id).toBe('test-1');
            expect(retrieved?.steps).toHaveLength(1);
        });
    });

    describe('updateEvolutionStatus', () => {
        it('应该更新进化状态', () => {
            const trajectory: Trajectory = {
                task_id: 'test-1',
                user_input: 'test input',
                steps: [],
                final_result: 'test result',
                environment_feedback: '',
                outcome: 'SUCCESS',
                used_rule_ids: [],
                timestamp: Date.now(),
                duration_ms: 100,
                evolution_status: 'PENDING',
            };

            adapter.saveTrajectory(trajectory);
            adapter.updateEvolutionStatus('test-1', 'COMPLETED');

            const retrieved = adapter.getTrajectory('test-1');
            expect(retrieved?.evolution_status).toBe('COMPLETED');
        });
    });

    describe('logDelta', () => {
        it('应该成功记录 Delta', () => {
            const delta = {
                rule_id: 'rule-1',
                action_type: 'ADD' as const,
                reasoning: 'test reasoning',
                change_payload: { test: 'data' },
                triggered_by_task_id: 'task-1',
                timestamp: Date.now(),
            };

            expect(() => adapter.logDelta(delta)).not.toThrow();
        });
    });
});
