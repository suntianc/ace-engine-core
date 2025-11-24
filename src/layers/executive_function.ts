
import { BaseLayer, AceStorages } from './base';
import { AceLayerID, SouthboundPacket, NorthboundPacket, BaseLLM, SouthboundType, NorthboundType } from '../types';
import { BusManager } from '../core/bus';
import { SessionManager } from '../types/session';
import crypto from 'crypto';

interface DAGTask {
    id: string;
    description: string;
    tool: string;
    dependencies: string[];
    status?: 'pending' | 'executing' | 'completed' | 'failed';
}

interface DAGPlan {
    tasks: DAGTask[];
    estimatedTokens: number;
    estimatedTimeMs: number;
}

export class ExecutiveFunctionLayer extends BaseLayer {

    constructor(bus: BusManager, storage: AceStorages, llm: BaseLLM, sessionManager?: SessionManager) {
        super(AceLayerID.EXECUTIVE_FUNCTION, bus, storage, llm, sessionManager);
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

            if (packet.targetLayer === this.id && packet.type === SouthboundType.PLAN) {
            console.log(`[ExecutiveFunction] Processing Plan: ${packet.content}`);

            // 1. Generate DAG (Task Breakdown)
            const dag = await this.generateDAG(packet.content);

            // 2. Store Active Plan with initial task states
            const planWithStates: DAGPlan = {
                ...dag,
                tasks: dag.tasks.map(t => ({ ...t, status: 'pending' as const }))
            };
            await this.storage.memory.set(`active_plan:${packet.id}`, JSON.stringify(planWithStates));

            // 3. Execute First Task (Find task with no dependencies)
            await this.executeNextTasks(packet.id, packet.traceId);
        } else if (packet.type === SouthboundType.CONTROL && packet.content === 'TASK_COMPLETE') {
            // Handle Task Completion & Trigger Next
            const taskId = packet.parameters?.taskId as string;
            const planId = packet.parameters?.planId as string;
            if (taskId && planId) {
                await this.handleTaskCompletion(planId, taskId, packet.traceId);
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

        // Handle Task Completion/Failure to trigger next task in DAG
        if (packet.sourceLayer === AceLayerID.COGNITIVE_CONTROL && (packet.type === NorthboundType.RESULT || packet.type === NorthboundType.FAILURE)) {
            const taskId = packet.data?.taskId as string;
            const planId = packet.data?.planId as string;
            
            if (taskId && planId) {
                if (packet.type === NorthboundType.RESULT) {
                    await this.handleTaskCompletion(planId, taskId, packet.traceId);
                } else {
                    await this.handleTaskFailure(planId, taskId, packet.traceId);
                }
            }
        }
    }

    private async generateDAG(plan: string): Promise<DAGPlan> {
        const prompt = `
You are the Executive Function Layer.
Break down the following plan into a list of executable tasks (DAG).
Each task should have:
- id: string (unique identifier)
- description: string (clear description of what the task does)
- tool: string (the tool/function to use)
- dependencies: string[] (IDs of tasks that must complete first - empty array if no dependencies)

Also estimate the resources needed:
- estimatedTokens: number (total estimated tokens for all tasks)
- estimatedTimeMs: number (total estimated time in milliseconds)

Plan:
\"${plan}\"

Output JSON format:
{
    "tasks": [
        { "id": "task1", "description": "...", "tool": "...", "dependencies": [] },
        { "id": "task2", "description": "...", "tool": "...", "dependencies": ["task1"] }
    ],
    "estimatedTokens": 100,
    "estimatedTimeMs": 1000
}
        `;

        try {
            const result = await this.llm.generateStructured<DAGPlan>(prompt, {});
            // Validate that all dependencies reference existing task IDs
            const taskIds = new Set(result.tasks.map(t => t.id));
            for (const task of result.tasks) {
                for (const dep of task.dependencies || []) {
                    if (!taskIds.has(dep)) {
                        console.warn(`[ExecutiveFunction] Invalid dependency ${dep} in task ${task.id}`);
                    }
                }
            }
            return result;
        } catch (e) {
            console.error("DAG generation failed", e);
            return { tasks: [], estimatedTokens: 0, estimatedTimeMs: 0 };
        }
    }

    private async executeNextTasks(planId: string, traceId: string) {
        const planJson = await this.storage.memory.get(`active_plan:${planId}`);
        if (!planJson) {
            console.error(`[ExecutiveFunction] Plan ${planId} not found (traceId: ${traceId}, layerId: ${this.id})`);
            return;
        }

        const plan: DAGPlan = JSON.parse(planJson);
        
        // Find tasks that are ready to execute (all dependencies completed)
        const readyTasks = plan.tasks.filter(task => {
            if (task.status !== 'pending') return false;
            if (!task.dependencies || task.dependencies.length === 0) return true;
            return task.dependencies.every(depId => {
                const depTask = plan.tasks.find(t => t.id === depId);
                return depTask?.status === 'completed';
            });
        });

        // Execute all ready tasks
        for (const task of readyTasks) {
            task.status = 'executing';
            await this.storage.memory.set(`active_plan:${planId}`, JSON.stringify(plan));

            await this.bus.publishSouthbound({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                traceId: traceId,
                sourceLayer: this.id,
                targetLayer: AceLayerID.COGNITIVE_CONTROL,
                type: SouthboundType.INSTRUCTION,
                content: `Execute task: ${task.description}`,
                parameters: { 
                    task: task,
                    taskId: task.id,
                    planId: planId
                }
            });
        }

        // Check if all tasks are completed
        const allCompleted = plan.tasks.every(t => t.status === 'completed' || t.status === 'failed');
        if (allCompleted) {
            console.log(`[ExecutiveFunction] All tasks in plan ${planId} completed`);
            // Optionally notify upper layers
        }
    }

    private async handleTaskCompletion(planId: string, taskId: string, traceId: string) {
        const planJson = await this.storage.memory.get(`active_plan:${planId}`);
        if (!planJson) {
            console.error(`[ExecutiveFunction] Plan ${planId} not found (traceId: ${traceId}, layerId: ${this.id}, taskId: ${taskId})`);
            return;
        }

        const plan: DAGPlan = JSON.parse(planJson);
        const task = plan.tasks.find(t => t.id === taskId);
        
        if (task) {
            task.status = 'completed';
            await this.storage.memory.set(`active_plan:${planId}`, JSON.stringify(plan));
            console.log(`[ExecutiveFunction] Task ${taskId} completed, triggering next tasks`);
            
            // Trigger next tasks that depend on this one
            await this.executeNextTasks(planId, traceId);
        }
    }

    private async handleTaskFailure(planId: string, taskId: string, traceId: string) {
        const planJson = await this.storage.memory.get(`active_plan:${planId}`);
        if (!planJson) {
            console.error(`[ExecutiveFunction] Plan ${planId} not found (traceId: ${traceId}, layerId: ${this.id}, taskId: ${taskId})`);
            return;
        }

        const plan: DAGPlan = JSON.parse(planJson);
        const task = plan.tasks.find(t => t.id === taskId);
        
        if (task) {
            task.status = 'failed';
            await this.storage.memory.set(`active_plan:${planId}`, JSON.stringify(plan));
            console.error(`[ExecutiveFunction] Task ${taskId} failed`);
            
            // Notify upper layers about the failure
            await this.bus.publishNorthbound({
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                traceId: traceId,
                sourceLayer: this.id,
                targetLayer: AceLayerID.AGENT_MODEL,
                type: NorthboundType.FAILURE,
                summary: `Task ${taskId} failed in plan ${planId}`,
                data: { taskId, planId, task }
            });
        }
    }
}
