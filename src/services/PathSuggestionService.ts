import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { MarkdownDocument } from "../MarkdownDocument";

const IGNORE = new Set(['node_modules', '.git', 'dist', '.DS_Store', 'out', '.vscode-test']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.ico']);

export class PathSuggestionService {
    public static async getPathSuggestions(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        id: string,
        query: string,
        uriMap: Map<string, string>,
    ): Promise<void> {
        const q = query.trim();
        if (!q) {
            panel.webview.postMessage({ type: 'pathSuggestions', id, items: [] });
            return;
        }

        const docFsPath = document.uri.fsPath;
        const docDir = path.dirname(docFsPath);
        const sep = path.sep;
        const workspaceFolder = vscode.workspace.workspaceFolders?.find(
            f => docFsPath.startsWith(f.uri.fsPath + sep),
        ) ?? vscode.workspace.workspaceFolders?.[0];
        const workspaceRoot = workspaceFolder?.uri.fsPath;

        const lastSlash = q.lastIndexOf('/');
        const dirPart = lastSlash >= 0 ? q.slice(0, lastSlash + 1) : '';
        const namePart = lastSlash >= 0 ? q.slice(lastSlash + 1) : q;

        let absDir: string;
        if (dirPart.startsWith('@/')) {
            absDir = workspaceRoot
                ? path.join(workspaceRoot, dirPart.slice(2))
                : docDir;
        } else if (dirPart === '' || dirPart.startsWith('./') || dirPart.startsWith('../')) {
            absDir = path.resolve(docDir, dirPart || '.');
        } else {
            absDir = path.resolve(docDir, dirPart);
        }

        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(absDir));
        } catch {
            panel.webview.postMessage({ type: 'pathSuggestions', id, items: [] });
            return;
        }

        const items = entries
            .filter(([name, type]) =>
                !IGNORE.has(name) &&
                name.toLowerCase().startsWith(namePart.toLowerCase()) &&
                (type === vscode.FileType.File || type === vscode.FileType.Directory) &&
                !(type === vscode.FileType.File && name.toLowerCase() === namePart.toLowerCase()),
            )
            .sort(([an, at], [bn, bt]) => {
                if (at !== bt) { return bt === vscode.FileType.Directory ? 1 : -1; }
                return an.localeCompare(bn);
            })
            .slice(0, 15)
            .map(([name, type]) => {
                const fullPath = dirPart + name + (type === vscode.FileType.Directory ? '/' : '');
                let webviewUri: string | undefined;
                if (type === vscode.FileType.File) {
                    const ext = path.extname(name).toLowerCase();
                    if (IMAGE_EXTS.has(ext)) {
                        const absFilePath = path.join(absDir, name);
                        webviewUri = panel.webview.asWebviewUri(vscode.Uri.file(absFilePath)).toString();
                        uriMap.set(webviewUri, fullPath);
                    }
                }
                return { path: fullPath, isDir: type === vscode.FileType.Directory, webviewUri };
            });

        panel.webview.postMessage({ type: 'pathSuggestions', id, items });
    }

    public static resolveImagePath(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        id: string,
        relPath: string,
        uriMap: Map<string, string>,
    ): void {
        if (document.uri.scheme !== 'file') { return; }
        const mdDir = path.dirname(document.uri.fsPath);
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
            ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        try {
            let absPath: string;
            if (relPath.startsWith('@/')) {
                const root = workspaceRoot ?? mdDir;
                absPath = path.join(root, relPath.slice(2));
            } else {
                absPath = path.resolve(mdDir, relPath);
            }
            if (!fs.existsSync(absPath)) { return; }
            const webviewUri = panel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
            uriMap.set(webviewUri, relPath);
            panel.webview.postMessage({ type: 'imagePathResolved', id, webviewUri });
        } catch { /* Invalid path, ignore */ }
    }
}
