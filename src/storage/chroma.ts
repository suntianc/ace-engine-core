
import { ChromaClient, Collection } from 'chromadb';

export class ChromaStorage {
    private client: ChromaClient;
    private collections: Record<string, Collection> = {};
    private prefix: string;

    constructor(endpoint: string, prefix: string = 'ace_v1') {
        this.client = new ChromaClient({ path: endpoint });
        this.prefix = prefix;
    }

    async init() {
        const names = ['episodic', 'knowledge', 'procedures'];
        for (const name of names) {
            const fullName = `${this.prefix}_${name}`;
            this.collections[name] = await this.client.getOrCreateCollection({
                name: fullName,
            });
        }
    }

    async addEpisodic(id: string, content: string, metadata: any) {
        await this.collections['episodic'].add({
            ids: [id],
            documents: [content],
            metadatas: [metadata],
        });
    }

    async queryEpisodic(query: string, nResults: number = 5) {
        return this.collections['episodic'].query({
            queryTexts: [query],
            nResults: nResults,
        });
    }

    // Similar methods for knowledge and procedures can be added as needed
}
