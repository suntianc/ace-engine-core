
import { ChromaClient, Collection } from 'chromadb';

export class ChromaStorage {
    private client: ChromaClient;
    private prefix: string;
    private episodicCollection?: Collection;
    private knowledgeCollection?: Collection;
    private proceduralCollection?: Collection;

    constructor(endpoint: string, prefix: string = 'ace_v1') {
        this.client = new ChromaClient({ path: endpoint });
        this.prefix = prefix;
    }

    async init() {
        this.episodicCollection = await this.client.getOrCreateCollection({
            name: `${this.prefix}_episodic`,
        });
        this.knowledgeCollection = await this.client.getOrCreateCollection({
            name: `${this.prefix}_knowledge`,
        });
        this.proceduralCollection = await this.client.getOrCreateCollection({
            name: `${this.prefix}_ace_procedures`,
        });
    }

    // --- Episodic Memory ---
    async addEpisodic(id: string, content: string, metadata: any) {
        if (!this.episodicCollection) return;
        await this.episodicCollection.add({
            ids: [id],
            documents: [content],
            metadatas: [metadata]
        });
    }

    async queryEpisodic(query: string, nResults: number = 5) {
        if (!this.episodicCollection) return { ids: [], documents: [], metadatas: [] };
        return await this.episodicCollection.query({
            queryTexts: [query],
            nResults: nResults
        });
    }

    // --- Semantic Knowledge ---
    async addKnowledge(id: string, content: string, metadata: any) {
        if (!this.knowledgeCollection) return;
        await this.knowledgeCollection.add({
            ids: [id],
            documents: [content],
            metadatas: [metadata]
        });
    }

    async queryKnowledge(query: string, nResults: number = 5) {
        if (!this.knowledgeCollection) return { ids: [], documents: [], metadatas: [] };
        return await this.knowledgeCollection.query({
            queryTexts: [query],
            nResults: nResults
        });
    }

    // --- Procedural Memory ---
    async addProcedure(id: string, content: string, metadata: any) {
        if (!this.proceduralCollection) return;
        await this.proceduralCollection.add({
            ids: [id],
            documents: [content],
            metadatas: [metadata]
        });
    }

    async queryProcedure(query: string, nResults: number = 5) {
        if (!this.proceduralCollection) return { ids: [], documents: [], metadatas: [] };
        return await this.proceduralCollection.query({
            queryTexts: [query],
            nResults: nResults
        });
    }

    /**
     * Close and cleanup resources
     */
    async close(): Promise<void> {
        // ChromaDB client may not have an explicit close method
        // Check if close method exists and call it
        if (this.client && typeof (this.client as any).close === 'function') {
            await (this.client as any).close();
        }
        // Clear collection references
        this.episodicCollection = undefined;
        this.knowledgeCollection = undefined;
        this.proceduralCollection = undefined;
    }
}
