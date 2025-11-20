/**
 * SQLite 适配器 - 轨迹和日志存储
 * @version 1.0.0
 */

import Database from 'better-sqlite3';
import { ITrajectoryStore } from '../interfaces/store';
import { Trajectory, DeltaLog } from '../types';
import path from 'path';

/**
 * SQLite 适配器实现
 * 使用 WAL 模式确保高性能并发读写
 */
export class SQLiteAdapter implements ITrajectoryStore {
  private db: Database.Database;
  private dbPath: string;

  /**
   * 构造函数
   * @param dbPath 数据库文件路径
   */
  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
    this.db = new Database(this.dbPath);

    // 开启 WAL 模式 - 关键！允许并发读写
    this.db.pragma('journal_mode = WAL');

    // 性能优化
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
  }

  /**
   * 初始化数据库表结构
   */
  init(): void {
    // 创建轨迹表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trajectories (
        id TEXT PRIMARY KEY,
        task_input TEXT NOT NULL,
        content TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS', 'FAILURE')),
        used_rule_ids TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        evolution_status TEXT DEFAULT 'PENDING' CHECK(
          evolution_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
        )
      );
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_traj_time ON trajectories(timestamp);
      CREATE INDEX IF NOT EXISTS idx_traj_status ON trajectories(evolution_status);
      CREATE INDEX IF NOT EXISTS idx_traj_outcome ON trajectories(outcome);
    `);

    // 创建 Delta 日志表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS delta_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id TEXT,
        action_type TEXT NOT NULL CHECK(
          action_type IN ('ADD', 'UPDATE', 'DELETE', 'MERGE')
        ),
        reasoning TEXT NOT NULL,
        change_payload TEXT NOT NULL,
        triggered_by_task_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);

    // 创建 Delta 索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_delta_rule ON delta_logs(rule_id);
      CREATE INDEX IF NOT EXISTS idx_delta_time ON delta_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_delta_task ON delta_logs(triggered_by_task_id);
    `);
  }

  /**
   * 保存任务轨迹 (同步写入)
   */
  saveTrajectory(trajectory: Trajectory): void {
    const stmt = this.db.prepare(`
      INSERT INTO trajectories (
        id, task_input, content, outcome, used_rule_ids,
        timestamp, duration_ms, evolution_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      trajectory.task_id,
      trajectory.user_input,
      JSON.stringify(trajectory),
      trajectory.outcome,
      JSON.stringify(trajectory.used_rule_ids),
      trajectory.timestamp,
      trajectory.duration_ms,
      trajectory.evolution_status || 'PENDING'
    );
  }

  /**
   * 获取任务轨迹
   */
  getTrajectory(id: string): Trajectory | null {
    const stmt = this.db.prepare(
      'SELECT content, evolution_status FROM trajectories WHERE id = ?'
    );
    const row = stmt.get(id) as { content: string; evolution_status: string } | undefined;

    if (!row) {
      return null;
    }

    const trajectory = JSON.parse(row.content) as Trajectory;
    // 覆盖状态，确保返回最新值
    trajectory.evolution_status = row.evolution_status as Trajectory['evolution_status'];

    return trajectory;
  }

  /**
   * 记录 Delta 日志
   */
  logDelta(delta: DeltaLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO delta_logs (
        rule_id, action_type, reasoning, change_payload,
        triggered_by_task_id, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      delta.rule_id,
      delta.action_type,
      delta.reasoning,
      JSON.stringify(delta.change_payload),
      delta.triggered_by_task_id,
      delta.timestamp
    );
  }

  /**
   * 更新轨迹的进化状态
   */
  updateEvolutionStatus(
    taskId: string,
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  ): void {
    const stmt = this.db.prepare(
      'UPDATE trajectories SET evolution_status = ? WHERE id = ?'
    );
    stmt.run(status, taskId);
  }

  /**
   * 获取数据库文件路径
   */
  getDbPath(): string {
    return this.dbPath;
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
  }
}
