/**
 * 工具函数测试
 */

import { generateId, extractJSON, safeParseJSON } from '../src/utils/helpers';

describe('helpers', () => {
    describe('generateId', () => {
        it('应该生成有效的 UUID', () => {
            const id = generateId();
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        });

        it('每次生成的 ID 应该不同', () => {
            const id1 = generateId();
            const id2 = generateId();
            expect(id1).not.toBe(id2);
        });
    });

    describe('extractJSON', () => {
        it('应该从代码块中提取 JSON', () => {
            const text = '```json\n{"key": "value"}\n```';
            const extracted = extractJSON(text);
            expect(extracted).toBe('{"key": "value"}');
        });

        it('应该从普通文本中提取 JSON', () => {
            const text = 'Some text {"key": "value"} more text';
            const extracted = extractJSON(text);
            expect(extracted).toBe('{"key": "value"}');
        });

        it('应该处理没有语言标识符的代码块', () => {
            const text = '```\n{"key": "value"}\n```';
            const extracted = extractJSON(text);
            expect(extracted).toBe('{"key": "value"}');
        });
    });

    describe('safeParseJSON', () => {
        it('应该正确解析 JSON', () => {
            const text = '{"key": "value"}';
            const parsed = safeParseJSON<{ key: string }>(text);
            expect(parsed).toEqual({ key: 'value' });
        });

        it('应该从代码块中解析 JSON', () => {
            const text = '```json\n{"key": "value"}\n```';
            const parsed = safeParseJSON<{ key: string }>(text);
            expect(parsed).toEqual({ key: 'value' });
        });

        it('解析失败时应该抛出错误', () => {
            const text = 'invalid json';
            expect(() => safeParseJSON(text)).toThrow();
        });
    });
});
