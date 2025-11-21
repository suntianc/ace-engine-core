
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
    }

    async handleNorthbound(packet: NorthboundPacket) {
        // Log telemetry
        await this.storage.duckdb.logTelemetry(packet);
    }

    private sandboxCheck(toolName: string, args: any): boolean {
        // Basic sandbox: forbid 'rm -rf', 'eval', etc. if they were shell commands
        // Here we just check against a whitelist or blacklist
        const BLACKLIST = ['eval', 'exec', 'system'];
        if (BLACKLIST.includes(toolName)) return false;

        // Check args for suspicious patterns
        const argsStr = JSON.stringify(args);
        if (argsStr.includes('rm -rf') || argsStr.includes('sudo')) return false;

        return true;
    }

    private async executeTool(toolName: string, args: any): Promise<any> {
        const tool = this.tools.get(toolName);
        if (tool) {
            // Validate args against schema
            tool.schema.parse(args);
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
