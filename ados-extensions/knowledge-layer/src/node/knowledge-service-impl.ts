import * as fs from 'fs-extra';
import * as path from 'path';
import Database from 'better-sqlite3';
import { inject, injectable, postConstruct, preDestroy } from '@theia/core/shared/inversify';
import { Loggable, Logger } from '@theia/core/lib/common/logger';
import { FileSystem } from '@theia/filesystem/lib/common/filesystem';
import { FileUri } from '@theia/core/lib/node/file-uri';

import {
    KnowledgeService,
    Note,
    NoteLink,
    SearchResult,
    NoteReadRequest,
    NoteWriteRequest,
    GraphQueryRequest,
    GraphResult
} from '../common/knowledge-service';

const VAULT_DIR = 'knowledge-vault';
const DB_PATH = 'knowledge.db';

@injectable()
export class KnowledgeServiceImpl implements KnowledgeService, Loggable {

    @inject(Logger)
    protected readonly logger: Logger;

    @inject(FileSystem)
    protected readonly fileSystem: FileSystem;

    private db: Database.Database;
    private vaultPath: string;

    @postConstruct()
    protected initialize(): void {
        this.setupDatabase();
        this.initializeVault();
        this.logger.info('Knowledge Service initialized successfully');
    }

    @preDestroy()
    protected dispose(): void {
        if (this.db) {
            this.db.close();
        }
        this.logger.info('Knowledge Service disposed');
    }

    private setupDatabase(): void {
        this.vaultPath = path.join(FileUri.fsPath(__dirname), VAULT_DIR);
        const dbPath = path.join(this.vaultPath, DB_PATH);

        // Ensure vault directory exists
        fs.ensureDirSync(this.vaultPath);

        this.db = new Database(dbPath);
        this.createTables();
        this.logger.info(`Database initialized at ${dbPath}`);
    }

    private createTables(): void {
        // Notes table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                path TEXT UNIQUE NOT NULL,
                tags TEXT, -- JSON array
                created INTEGER NOT NULL,
                modified INTEGER NOT NULL
            )
        `);

        // Links table for knowledge graph
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS links (
                from_id TEXT NOT NULL,
                to_id TEXT NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('reference', 'backlink')),
                context TEXT,
                FOREIGN KEY (from_id) REFERENCES notes(id) ON DELETE CASCADE,
                FOREIGN KEY (to_id) REFERENCES notes(id) ON DELETE CASCADE
            )
        `);

        // FTS5 virtual table for content search
        this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                id UNINDEXED,
                title,
                content,
                tokenize='porter'
            )
        `);

        this.logger.info('Database tables created/verified');
    }

    private initializeVault(): void {
        // Scan existing vault and index any Markdown files
        this.scanAndIndexVault().catch(error =>
            this.logger.error('Failed to initialize vault scan:', error)
        );
    }

    private extractLinks(content: string): NoteLink[] {
        // Simple link extraction - could be enhanced with more sophisticated parsing
        const links: NoteLink[] = [];
        const linkRegex = /\[\[([^\]]+)\]\]/g;
        let match;

        while ((match = linkRegex.exec(content)) !== null) {
            const targetTitle = match[1];
            // For now, we'll use title as ID - could be made more sophisticated
            links.push({
                to: targetTitle,
                type: 'reference',
                context: match[0]
            });
        }

        return links;
    }

    private indexNoteInFTS(note: Note): void {
        const insert = this.db.prepare(`
            INSERT OR REPLACE INTO notes_fts (id, title, content)
            VALUES (?, ?, ?)
        `);
        insert.run(note.id, note.title, note.content);
    }

    async createNote(title: string, content = '', tags: string[] = []): Promise<Note> {
        const id = title.toLowerCase().replace(/\s+/g, '-');
        const filePath = path.join(this.vaultPath, `${title}.md`);
        const now = new Date();

        const note: Note = {
            id,
            title,
            content,
            path: filePath,
            tags,
            created: now,
            modified: now,
            links: this.extractLinks(content)
        };

        // Write to disk
        await fs.ensureDir(this.vaultPath);
        await fs.writeFile(filePath, this.formatNoteAsMarkdown(note));

        // Store in database
        const insert = this.db.prepare(`
            INSERT INTO notes (id, title, content, path, tags, created, modified)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        insert.run(
            note.id,
            note.title,
            note.content,
            note.path,
            JSON.stringify(note.tags),
            note.created.getTime(),
            note.modified.getTime()
        );

        // Index for search
        this.indexNoteInFTS(note);

        // Create links
        this.updateLinks(note);

        this.logger.info(`Note created: ${title}`);
        return note;
    }

    async readNote(noteId: string): Promise<Note | undefined> {
        const select = this.db.prepare(`
            SELECT * FROM notes WHERE id = ?
        `);

        const row = select.get(noteId) as any;
        if (!row) {
            return undefined;
        }

        return {
            id: row.id,
            title: row.title,
            content: row.content,
            path: row.path,
            tags: JSON.parse(row.tags || '[]'),
            created: new Date(row.created),
            modified: new Date(row.modified),
            links: [] // Will be populated on demand
        };
    }

    async updateNote(noteId: string, updates: Partial<NoteWriteRequest>): Promise<Note> {
        const note = await this.readNote(noteId);
        if (!note) {
            throw new Error(`Note not found: ${noteId}`);
        }

        const updatedNote = {
            ...note,
            ...updates,
            modified: new Date(),
            links: this.extractLinks(updates.content || note.content)
        };

        // Update database
        const updateQuery = this.db.prepare(`
            UPDATE notes SET
                title = ?,
                content = ?,
                tags = ?,
                modified = ?
            WHERE id = ?
        `);

        updateQuery.run(
            updatedNote.title,
            updatedNote.content,
            JSON.stringify(updatedNote.tags),
            updatedNote.modified.getTime(),
            noteId
        );

        // Update file
        await fs.writeFile(updatedNote.path, this.formatNoteAsMarkdown(updatedNote));

        // Update search index
        this.indexNoteInFTS(updatedNote);

        // Update links
        this.updateLinks(updatedNote);

        this.logger.info(`Note updated: ${updatedNote.title}`);
        return updatedNote;
    }

    async deleteNote(noteId: string): Promise<boolean> {
        const note = await this.readNote(noteId);
        if (!note) {
            return false;
        }

        // Remove from database (links cascade delete)
        const deleteStmt = this.db.prepare('DELETE FROM notes WHERE id = ?');
        deleteStmt.run(noteId);

        // Remove search index
        const deleteFTS = this.db.prepare('DELETE FROM notes_fts WHERE id = ?');
        deleteFTS.run(noteId);

        // Remove file
        try {
            await fs.unlink(note.path);
        } catch (error) {
            this.logger.warn(`Failed to delete file: ${note.path}`, error);
        }

        this.logger.info(`Note deleted: ${note.title}`);
        return true;
    }

    async listNotes(): Promise<Note[]> {
        const select = this.db.prepare(`
            SELECT id, title, path, tags, created, modified
            FROM notes ORDER BY modified DESC
        `);

        const rows = select.all() as any[];
        return rows.map(row => ({
            ...row,
            tags: JSON.parse(row.tags || '[]'),
            created: new Date(row.created),
            modified: new Date(row.modified),
            content: '', // Lazy load content
            links: [] // Lazy load links
        }));
    }

    async search(query: string, tags?: string[], limit = 50): Promise<SearchResult[]> {
        let sql = `
            SELECT n.id, n.title, n.content, rank
            FROM notes_fts fts
            JOIN notes n ON fts.id = n.id
            WHERE notes_fts MATCH ?
        `;

        const params: any[] = [query];

        if (tags && tags.length > 0) {
            sql += ' AND ? IN (SELECT value FROM json_each(n.tags))';
            params.push(...tags);
        }

        sql += ' ORDER BY rank LIMIT ?';
        params.push(limit);

        const select = this.db.prepare(sql);
        const rows = select.all(...params) as any[];

        return rows.map(row => ({
            noteId: row.id,
            title: row.title,
            preview: row.content.substring(0, 200) + '...',
            score: row.rank,
            matches: [] // Could be enhanced with FTS5 snippeting
        }));
    }

    async getLinks(noteId: string, direction: 'outgoing' | 'incoming' | 'both' = 'outgoing', limit = 100): Promise<GraphResult> {
        let sql = '';
        const params: any[] = [];

        if (direction === 'outgoing' || direction === 'both') {
            sql += `
                SELECT to_id as other_id, type, context
                FROM links
                WHERE from_id = ?
            `;
            params.push(noteId);
        }

        if (direction === 'both') {
            sql += ' UNION ALL ';
        }

        if (direction === 'incoming' || direction === 'both') {
            sql += `
                SELECT from_id as other_id, type, context
                FROM links
                WHERE to_id = ?
            `;
            params.push(noteId);
        }

        sql += ` LIMIT ?`;
        params.push(limit);

        const select = this.db.prepare(sql);
        const rows = select.all(...params) as any[];

        const links: NoteLink[] = rows.map(row => ({
            to: row.other_id,
            type: row.type,
            context: row.context
        }));

        return {
            links,
            totalCount: links.length
        };
    }

    async scanAndIndexVault(vaultPathOverride?: string): Promise<void> {
        const scanPath = vaultPathOverride || this.vaultPath;

        this.logger.info(`Scanning vault at: ${scanPath}`);

        const files = await fs.readdir(scanPath);
        const mdFiles = files.filter(f => f.endsWith('.md') && f !== DB_PATH);

        for (const file of mdFiles) {
            try {
                const filePath = path.join(scanPath, file);
                const content = await fs.readFile(filePath, 'utf8');
                const title = path.basename(file, '.md');

                // Check if already indexed
                const existing = this.db.prepare('SELECT id FROM notes WHERE path = ?').get(filePath);
                if (existing) {
                    continue;
                }

                // Parse frontmatter if present (simplified)
                const { title: parsedTitle, tags } = this.parseFrontmatter(content);
                const finalTitle = parsedTitle || title;

                await this.createNote(finalTitle, content, tags);
            } catch (error) {
                this.logger.error(`Failed to index file: ${file}`, error);
            }
        }

        this.logger.info(`Vault scan complete. Indexed ${mdFiles.length} files.`);
    }

    watchVault(vaultPathOverride?: string): void {
        // File watching implementation would go here
        this.logger.info('Vault watching not yet implemented - would monitor for file changes');
    }

    // MCP Tool Implementations
    async toolReadNote(request: NoteReadRequest): Promise<Note | undefined> {
        if (request.noteId) {
            return this.readNote(request.noteId);
        } else if (request.path) {
            // Find by path
            const select = this.db.prepare('SELECT id FROM notes WHERE path = ?');
            const row = select.get(request.path) as any;
            return row ? this.readNote(row.id) : undefined;
        }
        return undefined;
    }

    async toolWriteNote(request: NoteWriteRequest): Promise<Note> {
        if (request.noteId) {
            return this.updateNote(request.noteId, request);
        } else {
            // Create new note
            return this.createNote(
                request.title || 'Untitled',
                request.content,
                request.tags
            );
        }
    }

    async toolSearchNotes(query: string, limit = 20): Promise<SearchResult[]> {
        return this.search(query, undefined, limit);
    }

    async toolQueryGraph(request: GraphQueryRequest): Promise<GraphResult> {
        if (!request.noteId) {
            return { links: [], totalCount: 0 };
        }
        return this.getLinks(request.noteId, request.direction, request.limit);
    }

    private formatNoteAsMarkdown(note: Note): string {
        let markdown = `# ${note.title}\n\n`;
        if (note.tags.length > 0) {
            markdown += `Tags: ${note.tags.map(tag => `#${tag}`).join(' ')}\n\n`;
        }
        markdown += note.content;
        return markdown;
    }

    private parseFrontmatter(content: string): { title?: string; tags: string[] } {
        // Very basic frontmatter parsing - could be enhanced
        const lines = content.split('\n');
        if (lines[0] === '---') {
            // Find closing ---
            const endIndex = lines.indexOf('---', 1);
            if (endIndex > 0) {
                const frontmatter = lines.slice(1, endIndex).join('\n');
                // Basic parsing - title and tags
                const titleMatch = frontmatter.match(/title:\s*(.+)/i);
                const tagsMatch = frontmatter.match(/tags:\s*\[([^\]]+)\]/i) ||
                                frontmatter.match(/tags:\s*(.+)/i);

                return {
                    title: titleMatch ? titleMatch[1].trim() : undefined,
                    tags: tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/^["']/g, '').replace(/["']$/g, '')) : []
                };
            }
        }
        return { tags: [] };
    }

    private updateLinks(note: Note): void {
        // Remove existing links
        this.db.prepare('DELETE FROM links WHERE from_id = ?').run(note.id);

        // Add new links to database
        const insertLink = this.db.prepare(`
            INSERT INTO links (from_id, to_id, type, context)
            VALUES (?, ?, ?, ?)
        `);

        note.links.forEach(link => {
            insertLink.run(note.id, link.to, link.type, link.context);
        });

        // Create backlinks for other notes
        this.createBacklinks(note);
    }

    private createBacklinks(note: Note): void {
        const updateBacklink = this.db.prepare(`
            INSERT OR IGNORE INTO links (from_id, to_id, type, context)
            VALUES (?, ?, 'backlink', '')
        `);

        note.links.forEach(link => {
            updateBacklink.run(link.to, note.id);
        });
    }
}
