
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, AceTool, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';
import { ReflectionTriggerEngine } from '../core/reflection_trigger';
import { ReflectionLevel } from '../types/reflection';
import { SessionManager } from '../types/session';
import crypto from 'crypto';

export class TaskProsecutionLayer extends BaseLayer {
    private tools: Map<string, AceTool> = new Map();
    private reflectionTrigger: ReflectionTriggerEngine;

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM, sessionManager?: SessionManager) {
        super(AceLayerID.TASK_PROSECUTION, bus, storage, llm, sessionManager);
        this.reflectionTrigger = new ReflectionTriggerEngine(storage);
    }

    registerTool(tool: AceTool) {
        this.tools.set(tool.name, tool);
    }

    async handleSouthbound(packet: SouthboundPacket) {
        // Acquire layer lock for concurrent safety
        const lockAcquired = await this.storage.memory.acquireLayerLock(this.id);
        if (!lockAcquired) {
            console.warn(`[${this.id}] Layer is locked, queuing packet ${packet.id}`);
            return;
        }

        try {
            // Check for empty content
            if (!packet.content || packet.content.trim() === '') {
                console.warn(`[${this.id}] Received empty content, ignoring packet ${packet.id} (traceId: ${packet.traceId})`);
                return;
            }

            if (packet.targetLayer === this.id && (packet.type === SouthboundType.CONTROL || packet.type === SouthboundType.INSTRUCTION)) {
            console.log(`[TaskProsecution] Processing Control: ${packet.content}`);

            const toolName = packet.parameters?.tool;
            const toolArgs = packet.parameters?.args || {};

            if (!toolName) {
                await this.reportFailure(packet, "No tool specified");
                return;
            }

            // 1. Sandbox Check
            if (!this.sandboxCheck(toolName, toolArgs)) {
                await this.reportFailure(packet, "Sandbox violation: Tool or args not allowed");
                return;
            }

            // 2. Generate Expected State (for prediction error detection)
            const expectedState = await this.generateExpectedState(toolName, toolArgs);

            // 3. Check Loop Detection (before execution)
            const sessionId = packet.sessionId || 'default';
            const loopDetection = await this.reflectionTrigger.checkLoopDetection(
                sessionId,
                { type: toolName, params: toolArgs, traceId: packet.traceId }
            );

            if (loopDetection) {
                await this.handleReflectionTrigger(loopDetection, packet);
                return;
            }

            // 4. Execute Tool
            try {
                const result = await this.executeTool(toolName, toolArgs);
                const actualState = this.extractActualState(result);

                // 5. Check Prediction Error
                const predictionError = await this.reflectionTrigger.checkPredictionError(
                    packet.traceId,
                    expectedState,
                    actualState,
                    packet.sessionId
                );

                if (predictionError) {
                    await this.handleReflectionTrigger(predictionError, packet);
                    // 继续执行，但已触发反思
                }

                // 6. Check Completion
                const completion = await this.reflectionTrigger.checkCompletion(
                    packet.traceId,
                    packet.parameters?.subgoalId || 'unknown',
                    result,
                    packet.sessionId
                );

                if (completion) {
                    await this.handleReflectionTrigger(completion, packet);
                }

                // 7. Report Success
                await this.bus.publishNorthbound({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    traceId: packet.traceId,
                    sessionId: packet.sessionId,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.COGNITIVE_CONTROL,
                    type: NorthboundType.RESULT,
                    summary: `Tool ${toolName} executed successfully`,
                    data: { result, expectedState, actualState }
                });
            } catch (error: any) {
                // 8. Check Feedback Trigger (negative feedback from error)
                const feedback = await this.reflectionTrigger.checkFeedback(
                    packet.traceId,
                    { type: 'negative', content: error.message },
                    packet.sessionId
                );

                if (feedback) {
                    await this.handleReflectionTrigger(feedback, packet);
                }

                await this.reportFailure(packet, `Tool execution failed: ${error.message}`);
            }
        }
        } finally {
            // Release lock
            await this.storage.memory.releaseLayerLock(this.id);
        }
    }

    async handleNorthbound(packet: NorthboundPacket) {
        // Check for empty summary
        if (!packet.summary || packet.summary.trim() === '') {
            console.warn(`[${this.id}] Received empty summary, ignoring packet ${packet.id} (traceId: ${packet.traceId})`);
            return;
        }

        // Log telemetry
        await this.storage.logs.logTelemetry(packet);
    }

    private sandboxCheck(toolName: string, args: any): boolean {
        // 1. Check if tool exists
        const tool = this.tools.get(toolName);
        if (!tool) {
            console.warn(`[TaskProsecution] Tool not found: ${toolName}`);
            return false;
        }

        // 2. Tool name blacklist check
        const BLACKLIST = ['eval', 'exec', 'system'];
        if (BLACKLIST.includes(toolName)) {
            console.warn(`[TaskProsecution] Tool ${toolName} is blacklisted`);
            return false;
        }

        // 3. Use Zod schema to validate parameters
        try {
            tool.schema.parse(args);
        } catch (error) {
            console.error(`[TaskProsecution] Schema validation failed for ${toolName}:`, error);
            return false;
        }

        // 4. Check args content for suspicious patterns
        const argsStr = JSON.stringify(args);
        const SUSPICIOUS_PATTERNS = [
            'rm -rf',
            'sudo',
            'mkfs',
            'dd if=/dev/zero',
            ':(){:|:&};:',
            'chmod 777',
            'format',
            'del /f'
        ];
        
        for (const pattern of SUSPICIOUS_PATTERNS) {
            if (argsStr.toLowerCase().includes(pattern.toLowerCase())) {
                console.warn(`[TaskProsecution] Suspicious pattern detected in args for ${toolName}: ${pattern}`);
                return false;
            }
        }

        return true;
    }

    private async executeTool(toolName: string, args: any): Promise<any> {
        const tool = this.tools.get(toolName);
        if (tool) {
            // Schema validation already done in sandboxCheck
            return await tool.execute(args);
        }

        // Mock execution if tool not found (for testing/prototyping without real tools)
        console.log(`[TaskProsecution] Executing (Mock) ${toolName} with args:`, args);
        return { status: 'success', output: `Executed ${toolName} (Mock)` };
    }

    private async reportFailure(packet: SouthboundPacket, reason: string) {
        console.error(`[TaskProsecution] Failure: ${reason}`);
        await this.bus.publishNorthbound({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            traceId: packet.traceId,
            sessionId: packet.sessionId,
            sourceLayer: this.id,
            targetLayer: AceLayerID.COGNITIVE_CONTROL,
            type: NorthboundType.FAILURE,
            summary: reason,
            data: { error: reason }
        });
    }

    /**
     * 生成预期状态（用于预测误差检测）
     */
    private async generateExpectedState(toolName: string, _args: any): Promise<any> {
        // 简化的预期状态生成
        // 实际可以使用 LLM 或规则引擎生成更准确的预期状态
        return {
            status: 'success',
            tool: toolName,
            timestamp: Date.now()
        };
    }

    /**
     * 提取实际状态
     */
    private extractActualState(result: any): any {
        return {
            status: result.status || 'unknown',
            data: result.data || result,
            timestamp: Date.now()
        };
    }

    /**
     * 处理反思触发
     */
    private async handleReflectionTrigger(trigger: any, packet: SouthboundPacket) {
        console.log(`[TaskProsecution] Reflection triggered: ${trigger.type} at level ${trigger.level}`);

        // 根据反思级别决定处理方式
        switch (trigger.level) {
            case ReflectionLevel.LOCAL:
                // 局部重试（不向上汇报）
                console.log(`[TaskProsecution] Performing local reflection for ${trigger.type}`);
                // 可以在这里实现局部重试逻辑
                break;
            case ReflectionLevel.STRATEGIC:
                // 向上汇报到策略层
                await this.bus.publishNorthbound({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    traceId: packet.traceId,
                    sessionId: packet.sessionId,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.GLOBAL_STRATEGY,
                    type: NorthboundType.FAILURE,
                    summary: `Reflection triggered: ${trigger.type}`,
                    data: { trigger, originalPacket: packet }
                });
                break;
            case ReflectionLevel.ASPIRATIONAL:
                // 向上汇报到愿景层
                await this.bus.publishNorthbound({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    traceId: packet.traceId,
                    sessionId: packet.sessionId,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.ASPIRATIONAL,
                    type: NorthboundType.CRITICAL_FAILURE,
                    summary: `Critical reflection triggered: ${trigger.type}`,
                    data: { trigger, originalPacket: packet }
                });
                break;
        }
    }
}
