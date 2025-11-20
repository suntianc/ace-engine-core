
import { BaseLLM } from '../../src/types';

export class MockLLM implements BaseLLM {
    private responses: Map<string, string> = new Map();
    private defaultResponse: string = '';

    constructor(defaultResponse: string = '') {
        this.defaultResponse = defaultResponse;
    }

    setResponse(key: string, response: string) {
        this.responses.set(key, response);
    }

    setDefaultResponse(response: string) {
        this.defaultResponse = response;
    }

    async generate(prompt: string): Promise<string> {
        // Simple keyword matching to return specific responses based on prompt content
        for (const [key, response] of this.responses.entries()) {
            if (prompt.includes(key)) {
                return response;
            }
        }
        return this.defaultResponse;
    }

    async generateStructured<T>(prompt: string, _schema: unknown): Promise<T> {
        const response = await this.generate(prompt);
        try {
            // Try to parse JSON from markdown code block if present
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]) as T;
            }
            return JSON.parse(response) as T;
        } catch (e) {
            console.error('MockLLM parse error:', e);
            throw e;
        }
    }
}
