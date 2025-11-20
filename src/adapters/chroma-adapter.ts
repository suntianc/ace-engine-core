/**
 * ChromaDB 适配器 - 向量存储
 * @version 1.0.0
 */

import { ChromaClient, Collection } from 'chromadb';
import { IVectorStore } from '../interfaces/store';
import { Rule } from '../types';

/**
 * ChromaDB 适配器实现
 */
export class ChromaAdapter implements IVectorStore {
    private client: ChromaClient;
    private collection: Collection | null = null;
    private collectionName: string;

    /**
     * 构造函数
     * @param client ChromaDB 客户端
     * @param collectionName 集合名称
     */
    constructor(client: ChromaClient, collectionName = 'ace_playbook') {
        this.client = client;
        this.collectionName = collectionName;
    }

    /**
     * 初始化集合
     */
    async init(): Promise<void> {
        this.collection = await this.client.getOrCreateCollection({
            name: this.collectionName,
            metadata: { description: 'ACE Engine Playbook Rules' },
        });
    }

    /**
     * 搜索相关规则
     */
    async search(query: string, limit: number): Promise<Rule[]> {
        if (!this.collection) {
            throw new Error('Collection not initialized. Call init() first.');
        }

        const results = await this.collection.query({
            queryTexts: [query],
            nResults: limit,
        });

        // 转换 ChromaDB 格式到 Rule 格式
        const rules: Rule[] = [];

        if (results.ids && results.ids[0]) {
            for (let i = 0; i < results.ids[0].length; i++) {
                const id = results.ids[0][i];
                const document = results.documents[0]?.[i];
                const metadata = results.metadatas[0]?.[i];
                const distance = results.distances?.[0]?.[i];

                if (typeof id === 'string' && typeof document === 'string' && metadata) {
                    rules.push({
                        id,
                        content: document,
                        metadata: {
                            created_at: (metadata.created_at as number) || Date.now(),
                            last_used_at: (metadata.last_used_at as number) || Date.now(),
                            success_count: (metadata.success_count as number) || 0,
                            failure_count: (metadata.failure_count as number) || 0,
                            source_task_id: metadata.source_task_id as string | undefined,
                        },
                        score: distance !== undefined ? 1 - distance : undefined,
                    });
                }
            }
        }

        return rules;
    }

    /**
   * 添加规则
   */
    async add(rules: Omit<Rule, 'score'>[]): Promise<void> {
        if (!this.collection) {
            throw new Error('Collection not initialized. Call init() first.');
        }

        if (rules.length === 0) {
            return;
        }

        // 转换metadata为ChromaDB兼容格式
        const metadatas = rules.map((r) => ({
            created_at: r.metadata.created_at,
            last_used_at: r.metadata.last_used_at,
            success_count: r.metadata.success_count,
            failure_count: r.metadata.failure_count,
            source_task_id: r.metadata.source_task_id || '',
        }));

        await this.collection.add({
            ids: rules.map((r) => r.id),
            documents: rules.map((r) => r.content),
            metadatas,
        });
    }

    /**
   * 更新规则
   */
    async update(
        id: string,
        content?: string,
        metadata?: Partial<Rule['metadata']>
    ): Promise<void> {
        if (!this.collection) {
            throw new Error('Collection not initialized. Call init() first.');
        }

        // 先获取现有规则
        const existing = await this.collection.get({ ids: [id] });

        if (!existing.ids || existing.ids.length === 0) {
            throw new Error(`Rule not found: ${id}`);
        }

        const currentDocument = existing.documents[0] as string;
        const currentMetadata = existing.metadatas[0] as Record<string, unknown>;

        // 合并更新
        const newDocument = content || currentDocument;
        const mergedMetadata = metadata ? { ...currentMetadata, ...metadata } : currentMetadata;

        // 转换为ChromaDB兼容格式
        const newMetadata = {
            created_at: (mergedMetadata.created_at as number) || Date.now(),
            last_used_at: (mergedMetadata.last_used_at as number) || Date.now(),
            success_count: (mergedMetadata.success_count as number) || 0,
            failure_count: (mergedMetadata.failure_count as number) || 0,
            source_task_id: (mergedMetadata.source_task_id as string) || '',
        };

        await this.collection.update({
            ids: [id],
            documents: [newDocument],
            metadatas: [newMetadata],
        });
    }

    /**
     * 删除规则
     */
    async delete(ids: string[]): Promise<void> {
        if (!this.collection) {
            throw new Error('Collection not initialized. Call init() first.');
        }

        if (ids.length === 0) {
            return;
        }

        await this.collection.delete({ ids });
    }
}
