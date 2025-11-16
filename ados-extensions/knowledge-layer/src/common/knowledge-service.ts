import { CommandRegistry } from '@theia/core';

export interface Note {
    id: string;
    title: string;
    content: string;
    path: string;
    tags: string[];
    created: Date;
    modified: Date;
    links: NoteLink[];
}

export interface NoteLink {
    to: string; // Note ID
    type: 'reference' | 'backlink';
    context: string; // Text around the link
}

export interface SearchResult {
    noteId: string;
    title: string;
    preview: string;
    score: number;
    matches: string[]; // Matching text snippets
}

export const KnowledgeService = Symbol('KnowledgeService');

// MCP Tool interfaces for agents
export interface NoteReadRequest {
    noteId?: string;
    path?: string;
}

export interface NoteWriteRequest {
    noteId?: string;
    path?: string;
    content: string;
    title?: string;
    tags?: string[];
}

export interface GraphQueryRequest {
    noteId?: string;
    direction?: 'outgoing' | 'incoming' | 'both';
    limit?: number;
}

export interface GraphResult {
    links: NoteLink[];
    totalCount: number;
}

export interface KnowledgeService {
    // Note management
    createNote(title: string, content?: string, tags?: string[]): Promise<Note>;
    readNote(noteId: string): Promise<Note | undefined>;
    updateNote(noteId: string, updates: Partial<NoteWriteRequest>): Promise<Note>;
    deleteNote(noteId: string): Promise<boolean>;
    listNotes(): Promise<Note[]>;

    // Search
    search(query: string, tags?: string[], limit?: number): Promise<SearchResult[]>;

    // Knowledge graph
    getLinks(noteId: string, direction?: 'outgoing' | 'incoming' | 'both', limit?: number): Promise<GraphResult>;

    // File synchronization
    scanAndIndexVault(vaultPath?: string): Promise<void>;
    watchVault(vaultPath?: string): void;

    // MCP tools for agents
    toolReadNote(request: NoteReadRequest): Promise<Note | undefined>;
    toolWriteNote(request: NoteWriteRequest): Promise<Note>;
    toolSearchNotes(query: string, limit?: number): Promise<SearchResult[]>;
    toolQueryGraph(request: GraphQueryRequest): Promise<GraphResult>;
}
