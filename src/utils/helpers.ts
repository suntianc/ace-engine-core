/**
 * 工具函数
 * @version 1.0.0
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * 生成 UUID
 */
export function generateId(): string {
    return uuidv4();
}

/**
 * 从文本中提取 JSON
 * 支持提取被代码块包裹的 JSON
 */
export function extractJSON(text: string): string {
    // 尝试提取代码块中的内容
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        return codeBlockMatch[1].trim();
    }

    // 尝试直接返回 JSON 片段
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return jsonMatch[0];
    }

    return text.trim();
}

/**
 * 安全解析 JSON
 */
export function safeParseJSON<T>(text: string): T {
    try {
        const extracted = extractJSON(text);
        return JSON.parse(extracted) as T;
    } catch (error) {
        throw new Error(
            `Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}\n\nOriginal text:\n${text}`
        );
    }
}

/**
 * 延迟函数
 */
export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 重试函数
 */
export async function retry<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries?: number;
        delayMs?: number;
        onRetry?: (error: Error, attempt: number) => void;
    } = {}
): Promise<T> {
    const { maxRetries = 3, delayMs = 1000, onRetry } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt < maxRetries) {
                if (onRetry) {
                    onRetry(lastError, attempt);
                }
                await delay(delayMs);
            }
        }
    }

    throw lastError;
}
