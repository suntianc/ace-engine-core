
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, AceTool, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';
import crypto from 'crypto';

export class TaskProsecutionLayer extends BaseLayer {
    private tools: Map<string, AceTool> = new Map();

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM) {
        super(AceLayerID.TASK_PROSECUTION, bus, storage, llm);
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

            // 2. Execute Tool
            try {
                const result = await this.executeTool(toolName, toolArgs);

                // 3. Report Success
                await this.bus.publishNorthbound({
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    traceId: packet.traceId,
                    sourceLayer: this.id,
                    targetLayer: AceLayerID.COGNITIVE_CONTROL,
                    type: NorthboundType.RESULT,
                    summary: `Tool ${toolName} executed successfully`,
                    data: { result }
                });
            } catch (error: any) {
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
        await this.storage.duckdb.logTelemetry(packet);
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
            sourceLayer: this.id,
            targetLayer: AceLayerID.COGNITIVE_CONTROL,
            type: NorthboundType.FAILURE,
            summary: reason,
            data: { error: reason }
        });
    }
}
