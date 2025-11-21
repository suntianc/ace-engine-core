import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';
import { AceCacheConfig } from '../types';
import { ConfigurationError } from '../utils/errors';

import { EventEmitter } from 'eventemitter3';

export class MemoryStorage extends EventEmitter {
    private redis: Redis | null = null;
    private lru: LRUCache<string, string> | null = null;
    private type: 'redis' | 'memory';
    private maxContextWindow: number;

    constructor(config: AceCacheConfig, maxContextWindow?: number) {
        super();
        this.type = config.type;
        this.maxContextWindow = maxContextWindow ?? 10; // Default: 10
        if (this.type === 'redis' && config.redisUrl) {
            try {
                this.redis = new Redis(config.redisUrl);
                // Listen for connection errors
                this.redis.on('error', (err) => {
                    console.error('[MemoryStorage] Redis connection error:', err);
                });
            } catch (error) {
                throw new ConfigurationError(`Failed to connect to Redis: ${error instanceof Error ? error.message : String(error)}`);
            }
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
        const key = `context_window:${sessionId}`;
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

    // --- Layer Lock Functions ---
    
    /**
     * Acquire a lock for a specific layer
     * @param layerId The layer ID to lock
     * @param timeout Optional timeout in seconds (default: 60)
     * @returns true if lock was acquired, false if already locked
     */
    async acquireLayerLock(layerId: string, timeout: number = 60): Promise<boolean> {
        const key = `layer_lock:${layerId}`;
        const lockValue = `${Date.now()}`; // Use timestamp as lock value

        if (this.type === 'redis' && this.redis) {
            // Redis: Use SET NX EX for atomic lock acquisition with expiration
            const result = await this.redis.set(key, lockValue, 'EX', timeout, 'NX');
            return result === 'OK';
        } else if (this.lru) {
            // Memory: LRU Cache handles TTL automatically
            // If key exists and is not expired, LRU Cache will return it
            // If key is expired, LRU Cache will return undefined
            const existing = this.lru.get(key);
            if (existing) {
                return false; // Lock already exists and is valid (TTL handled by LRU)
            }
            // Acquire lock with TTL (LRU Cache will automatically expire it)
            this.lru.set(key, lockValue, { ttl: timeout * 1000 });
            return true;
        }
        return false;
    }

    /**
     * Release a lock for a specific layer
     * @param layerId The layer ID to unlock
     */
    async releaseLayerLock(layerId: string): Promise<void> {
        const key = `layer_lock:${layerId}`;

        if (this.type === 'redis' && this.redis) {
            await this.redis.del(key);
        } else if (this.lru) {
            this.lru.delete(key);
        }
    }

    /**
     * Check if a layer is currently locked
     * @param layerId The layer ID to check
     * @returns true if locked, false if not locked or lock expired
     */
    async isLayerLocked(layerId: string): Promise<boolean> {
        const key = `layer_lock:${layerId}`;

        if (this.type === 'redis' && this.redis) {
            const exists = await this.redis.exists(key);
            return exists === 1;
        } else if (this.lru) {
            const lockValue = this.lru.get(key);
            if (!lockValue) {
                return false;
            }
            // For memory mode, we rely on LRU TTL, so if it exists, it's valid
            return true;
        }
        return false;
    }

    private async checkAndEvict(sessionId: string) {
        const key = `context_window:${sessionId}`;
        let list: string[] = [];

        if (this.type === 'redis' && this.redis) {
            list = await this.redis.lrange(key, 0, -1);
        } else if (this.lru) {
            const current = this.lru.get(key) || '[]';
            list = JSON.parse(current as string);
        }

        if (list.length > this.maxContextWindow) {
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

    /**
     * Close and cleanup resources
     */
    async close(): Promise<void> {
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
        // LRU Cache will be garbage collected, but clear reference for safety
        this.lru = null;
    }
}
