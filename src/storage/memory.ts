import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';
import { AceCacheConfig } from '../types';

import { EventEmitter } from 'eventemitter3';

export class MemoryStorage extends EventEmitter {
    private redis: Redis | null = null;
    private lru: LRUCache<string, string> | null = null;
    private type: 'redis' | 'memory';
    private static MAX_CONTEXT_WINDOW = 10; // Example limit

    constructor(config: AceCacheConfig) {
        super();
        this.type = config.type;
        if (this.type === 'redis' && config.redisUrl) {
            this.redis = new Redis(config.redisUrl);
        } else {
            this.lru = new LRUCache({
                max: 1000,
                ttl: 1000 * 60 * 60, // 1 hour
            });
        }
    }

    async set(key: string, value: string, ttlSeconds?: number) {
        if (this.type === 'redis' && this.redis) {
            if (ttlSeconds) {
                await this.redis.set(key, value, 'EX', ttlSeconds);
            } else {
                await this.redis.set(key, value);
            }
        } else if (this.lru) {
            this.lru.set(key, value, { ttl: ttlSeconds ? ttlSeconds * 1000 : undefined });
        }
    }

    async get(key: string): Promise<string | null | undefined> {
        if (this.type === 'redis' && this.redis) {
            return await this.redis.get(key);
        } else if (this.lru) {
            return this.lru.get(key);
        }
        return null;
    }

    async pushToContextWindow(sessionId: string, content: string) {
        const key = `context:${sessionId}`;
        if (this.type === 'redis' && this.redis) {
            await this.redis.rpush(key, content);
            await this.checkAndEvict(sessionId);
        } else if (this.lru) {
            const current = this.lru.get(key) || '[]';
            const list = JSON.parse(current as string);
            list.push(content);
            this.lru.set(key, JSON.stringify(list));
            await this.checkAndEvict(sessionId);
        }
    }

    private async checkAndEvict(sessionId: string) {
        const key = `context:${sessionId}`;
        let list: string[] = [];

        if (this.type === 'redis' && this.redis) {
            list = await this.redis.lrange(key, 0, -1);
        } else if (this.lru) {
            const current = this.lru.get(key) || '[]';
            list = JSON.parse(current as string);
        }

        if (list.length > MemoryStorage.MAX_CONTEXT_WINDOW) {
            const evicted = list.shift(); // Remove oldest
            // Update storage
            if (this.type === 'redis' && this.redis) {
                await this.redis.lpop(key);
            } else if (this.lru) {
                this.lru.set(key, JSON.stringify(list));
            }

            if (evicted) {
                this.emit('eviction', { sessionId, content: evicted });
            }
        }
    }
}
