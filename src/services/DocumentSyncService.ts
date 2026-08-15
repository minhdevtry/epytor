import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import type { MarkdownDocument } from "../MarkdownDocument";

const FS_WATCH_DEBOUNCE_MS = 200;

export class DocumentSyncService {
    private static _lastSavedHashes = new Map<string, string>();

    public static recordSavedContent(uriKey: string, content: string): void {
        const hash = crypto.createHash("md5").update(content).digest("hex");
        this._lastSavedHashes.set(uriKey, hash);
    }

    public static clear(uriKey: string): void {
        this._lastSavedHashes.delete(uriKey);
    }

    public static setupFileWatcher(
        document: MarkdownDocument,
        uriKey: string,
        webviewPanel: vscode.WebviewPanel,
        onRevert: (content: string) => void,
    ): void {
        if (document.uri.scheme !== 'file') return;

        // Initialize with initial document hash
        this.recordSavedContent(uriKey, document.getText());

        import("fs").then(({ watch: fsWatch }) => {
            let debounceTimer: ReturnType<typeof setTimeout> | undefined;
            const targetFile = path.basename(document.uri.fsPath);

            const fsWatcher = fsWatch(path.dirname(document.uri.fsPath), async (_event, filename) => {
                if (filename !== targetFile) { return; }

                if (debounceTimer !== undefined) { clearTimeout(debounceTimer); }
                debounceTimer = setTimeout(async () => {
                    debounceTimer = undefined;

                    try {
                        const bytes = await vscode.workspace.fs.readFile(document.uri);
                        const fileContent = Buffer.from(bytes).toString("utf-8");
                        const currentFileHash = crypto.createHash("md5").update(fileContent).digest("hex");
                        const lastSavedHash = DocumentSyncService._lastSavedHashes.get(uriKey);

                        // If file hash is identical to our last saved version, skip revert
                        if (lastSavedHash && currentFileHash === lastSavedHash) {
                            return;
                        }

                        const cts = new vscode.CancellationTokenSource();
                        try {
                            await document.revert(cts.token);
                            DocumentSyncService.recordSavedContent(uriKey, document.getText());
                            onRevert(document.getText());
                        } finally {
                            cts.dispose();
                        }
                    } catch {
                        // File read error / deletion during watch, ignore
                    }
                }, FS_WATCH_DEBOUNCE_MS);
            });

            webviewPanel.onDidDispose(() => {
                fsWatcher.close();
                DocumentSyncService.clear(uriKey);
            });
        });
    }
}
