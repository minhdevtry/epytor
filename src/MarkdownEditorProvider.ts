import * as path from "path";
import * as vscode from "vscode";
import { MarkdownDocument } from "./MarkdownDocument";
import { getNonce } from "./utils/getNonce";
import { ZH_CN_WEBVIEW } from "./i18n/webviewTranslations";
import { computeLineMap } from "./utils/lineMap";
import { extractFrontmatter, restoreContentForSave } from "./utils/contentTransform";
import type { ToExtensionMessage, ToWebviewMessage } from "../shared/messages";
import { PathSuggestionService } from "./services/PathSuggestionService";
import { ImageManagementService } from "./services/ImageManagementService";
import { DocumentSyncService } from "./services/DocumentSyncService";

// ─── Constants ────────────────────────────────────────────────
const GLOBAL_REVEAL_LINE_TTL_MS = 10_000;
const NAV_SUPPRESS_DURATION_MS = 1500;
const PENDING_NAVIGATION_TTL_MS = 5000;
const REVEAL_LINE_DELAYED_CHECK_MS = 1000;
const AUTO_SWITCH_SUPPRESS_DURATION_MS = 2000;

export class MarkdownEditorProvider
    implements vscode.CustomEditorProvider<MarkdownDocument> {
    public static readonly viewType = "epytor.editor";

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<MarkdownDocument>
    >();
    public readonly onDidChangeCustomDocument =
        this._onDidChangeCustomDocument.event;

    // Auto-save debounce timer (key: document uri string)
    private readonly _autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // Track active webview panels
    private readonly _webviewPanels = new Map<string, vscode.WebviewPanel>();

    // Keep track of pinned editor tabs
    private readonly _pinnedDocuments = new Set<string>();

    // Image webviewUri → relPath mapping (key: docUri.toString())
    private readonly _imageUriMaps = new Map<string, Map<string, string>>();
    private readonly _frontmatterMap = new Map<string, string>(); // uriKey → raw frontmatter string

    /** When switching to text editor, suppress auto-switching back */
    public static readonly suppressAutoSwitch = new Set<string>();

    // Pending line navigation
    private readonly _pendingNavigations = new Map<string, { line: number; ts: number }>();

    // Global reveal line fallback
    private _pendingRevealLine: { line: number; ts: number } | undefined;

    // Initialized panels
    private readonly _initializedPanels = new Set<string>();

    // Suppress active text editor navigation reporting
    private _suppressNavFromTextEditor = false;

    public static current: MarkdownEditorProvider | null = null;

    private readonly _statusBarItem: vscode.StatusBarItem;
    private readonly _wordCounts = new Map<string, { lines: number; words: number; charsNoSpace: number; charsWithSpace: number }>();

    constructor(
        private readonly context: vscode.ExtensionContext,
    ) {
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this._statusBarItem.hide();
    }

    public setGlobalRevealLine(line: number): void {
        this._pendingRevealLine = { line, ts: Date.now() };
    }

    private _consumeGlobalRevealLine(): number | undefined {
        const p = this._pendingRevealLine;
        if (!p) { return undefined; }
        this._pendingRevealLine = undefined;
        if (Date.now() - p.ts > GLOBAL_REVEAL_LINE_TTL_MS) { return undefined; }
        return p.line;
    }

    public getAllMdFsPaths(): string[] {
        const paths: string[] = [];
        for (const uriKey of this._webviewPanels.keys()) {
            try {
                const uri = vscode.Uri.parse(uriKey);
                if (uri.fsPath.endsWith('.md') || uri.fsPath.endsWith('.markdown')) {
                    paths.push(uri.fsPath);
                }
            } catch {
                // Ignore invalid URIs
            }
        }
        return paths;
    }

    public suppressNavFromTextEditor(): void {
        this._suppressNavFromTextEditor = true;
        setTimeout(() => { this._suppressNavFromTextEditor = false; }, NAV_SUPPRESS_DURATION_MS);
    }

    public get isNavFromTextEditorSuppressed(): boolean {
        return this._suppressNavFromTextEditor;
    }

    public setPendingNavigation(fsPath: string, line: number): void {
        this._pendingNavigations.set(fsPath, { line, ts: Date.now() });
        const uriKey = vscode.Uri.file(fsPath).toString();
        const initialized = this._initializedPanels.has(uriKey);
        if (initialized) {
            const panel = this._webviewPanels.get(uriKey);
            if (panel && panel.visible) {
                panel.webview.postMessage({ type: 'scrollToLine', line });
            }
        }
    }

    public postToPanel(uri: vscode.Uri, msg: ToWebviewMessage): void {
        const panel = this._webviewPanels.get(uri.toString());
        if (panel) { panel.webview.postMessage(msg); }
    }

    public scrollPanelToLine(uri: vscode.Uri, line: number): void {
        const uriKey = uri.toString();
        const panel = this._webviewPanels.get(uriKey);
        if (panel) {
            panel.webview.postMessage({ type: 'scrollToLine', line });
        }
    }

    private _consumePendingNavigation(fsPath: string): number | undefined {
        const pending = this._pendingNavigations.get(fsPath);
        if (!pending) { return undefined; }
        this._pendingNavigations.delete(fsPath);
        if (Date.now() - pending.ts > PENDING_NAVIGATION_TTL_MS) { return undefined; }
        return pending.line;
    }

    public postToAll(msg: ToWebviewMessage): void {
        for (const panel of this._webviewPanels.values()) {
            panel.webview.postMessage(msg);
        }
    }

    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        const provider = new MarkdownEditorProvider(context);
        MarkdownEditorProvider.current = provider;
        return vscode.window.registerCustomEditorProvider(
            MarkdownEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
                supportsMultipleEditorsPerDocument: false,
            },
        );
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<MarkdownDocument> {
        return MarkdownDocument.create(uri);
    }

    async resolveCustomEditor(
        document: MarkdownDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        if (document.uri.scheme !== 'file') {
            webviewPanel.webview.html = '<!DOCTYPE html><html><body></body></html>';
            return;
        }

        const uriKey = document.uri.toString();
        this._webviewPanels.set(uriKey, webviewPanel);

        webviewPanel.onDidDispose(() => {
            this._webviewPanels.delete(uriKey);
            this._pinnedDocuments.delete(uriKey);
            this._imageUriMaps.delete(uriKey);
            this._initializedPanels.delete(uriKey);
            this._wordCounts.delete(uriKey);
            const timer = this._autoSaveTimers.get(uriKey);
            if (timer !== undefined) {
                clearTimeout(timer);
                this._autoSaveTimers.delete(uriKey);
            }
            this._statusBarItem.hide();
        });

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "dist"),
                ...(vscode.workspace.workspaceFolders?.map(f => f.uri) ?? []),
                vscode.Uri.joinPath(document.uri, '..'),
            ],
        };
        webviewPanel.webview.html = this._getHtmlForWebview(webviewPanel.webview);

        webviewPanel.onDidChangeViewState(({ webviewPanel: p }) => {
            if (!p.active) {
                setTimeout(() => {
                    const anyActive = Array.from(this._webviewPanels.values()).some(
                        (panel) => {
                            try { return panel.active; } catch { return false; }
                        },
                    );
                    if (!anyActive) this._statusBarItem.hide();
                }, 0);
                return;
            }

            const wc = this._wordCounts.get(uriKey);
            if (wc) {
                this._statusBarItem.text = vscode.l10n.t('Lines(src): {0}  Words: {1}  Chars: {2}', wc.lines, wc.words.toLocaleString(), wc.charsNoSpace.toLocaleString());
                this._statusBarItem.tooltip = vscode.l10n.t('Chars (with spaces): {0}', wc.charsWithSpace.toLocaleString());
                this._statusBarItem.show();
            } else {
                this._statusBarItem.hide();
            }

            if (!this._initializedPanels.has(uriKey)) { return; }
            const line = this._consumePendingNavigation(document.uri.fsPath)
                ?? this._consumeGlobalRevealLine();
            if (line !== undefined) {
                p.webview.postMessage({ type: "scrollToLine", line });
                return;
            }

            setTimeout(() => {
                try {
                    if (!p.active) { return; }
                } catch {
                    return;
                }
                const delayedLine = this._consumePendingNavigation(document.uri.fsPath)
                    ?? this._consumeGlobalRevealLine();
                if (delayedLine !== undefined) {
                    p.webview.postMessage({ type: "scrollToLine", line: delayedLine });
                }
            }, REVEAL_LINE_DELAYED_CHECK_MS);
        });

        webviewPanel.webview.onDidReceiveMessage(
            async (message: ToExtensionMessage) => {
                const panel = webviewPanel;
                const uriMap = this._getOrCreateUriMap(uriKey);

                switch (message.type) {
                    case "ready": {
                        this._initializedPanels.add(uriKey);
                        const initContent = document.getText();
                        const displayContent = this._prepareContentForDisplay(initContent, document, webviewPanel, uriKey);
                        const scrollToLine = this._consumePendingNavigation(document.uri.fsPath)
                            ?? this._consumeGlobalRevealLine();
                        webviewPanel.webview.postMessage({
                            type: "init",
                            content: displayContent,
                            lineMap: computeLineMap(initContent),
                            frontmatter: this._frontmatterMap.get(uriKey) || undefined,
                            imageUriMap: Object.fromEntries(uriMap),
                            ...(scrollToLine !== undefined ? { scrollToLine } : {}),
                        });
                        break;
                    }
                    case "update":
                        if (message.content !== undefined) {
                            const newContent = this._prepareContentForSave(message.content, uriKey);
                            if (newContent === document.getText()) { break; }
                            document.update(newContent);
                            if (!this._pinnedDocuments.has(uriKey)) {
                                this._pinnedDocuments.add(uriKey);
                                vscode.commands.executeCommand('workbench.action.keepEditor');
                            }
                            this._scheduleAutoSaveOrMarkDirty(document);
                        }
                        break;
                    case "openUrl":
                        if (message.url) {
                            vscode.env.openExternal(vscode.Uri.parse(message.url));
                        }
                        break;
                    case "openFile":
                        await this._handleOpenFile(message.path, document);
                        break;
                    case "switchToTextEditor":
                        await this._handleSwitchToTextEditor(message.line, document, webviewPanel);
                        break;
                    case "openSettings":
                        vscode.commands.executeCommand('workbench.action.openSettings', 'epytor');
                        break;
                    case "uploadImage":
                        if (message.id && message.data) {
                            ImageManagementService.handleImageUpload(
                                document, panel, message.id, message.data,
                                message.mimeType ?? 'image/png', message.altText ?? '', uriMap,
                            ).catch(() => {});
                        }
                        break;
                    case "getProjectImages":
                        if (message.id) {
                            ImageManagementService.handleGetProjectImages(document, panel, message.id, uriMap).catch(() => {});
                        }
                        break;
                    case "renameImage":
                        if (message.id && message.webviewUri && message.newBasename) {
                            ImageManagementService.handleImageRename(
                                document, panel, message.id, message.webviewUri, message.newBasename, uriMap,
                            ).catch(() => {});
                        }
                        break;
                    case "getPathSuggestions":
                        if (message.id && message.query !== undefined) {
                            PathSuggestionService.getPathSuggestions(document, panel, message.id, message.query, uriMap).catch(() => {});
                        }
                        break;
                    case "resolveImagePath":
                        if (message.id && message.relPath) {
                            PathSuggestionService.resolveImagePath(document, panel, message.id, message.relPath, uriMap);
                        }
                        break;
                    case "wordCount":
                        this._wordCounts.set(uriKey, {
                            lines: message.lines,
                            words: message.words,
                            charsNoSpace: message.charsNoSpace,
                            charsWithSpace: message.charsWithSpace,
                        });
                        if (panel.active) {
                            this._statusBarItem.text = vscode.l10n.t('Lines(src): {0}  Words: {1}  Chars: {2}', message.lines, message.words.toLocaleString(), message.charsNoSpace.toLocaleString());
                            this._statusBarItem.tooltip = vscode.l10n.t('Chars (with spaces): {0}', message.charsWithSpace.toLocaleString());
                            this._statusBarItem.show();
                        }
                        break;
                }
            },
        );

        // Setup File Watcher with content hash sync
        DocumentSyncService.setupFileWatcher(document, uriKey, webviewPanel, (revertedContent) => {
            const panel = this._webviewPanels.get(uriKey);
            if (panel) {
                const displayContent = this._prepareContentForDisplay(revertedContent, document, panel, uriKey);
                const uriMap = this._getOrCreateUriMap(uriKey);
                panel.webview.postMessage({
                    type: "revert",
                    content: displayContent,
                    lineMap: computeLineMap(revertedContent),
                    frontmatter: this._frontmatterMap.get(uriKey) || undefined,
                    imageUriMap: Object.fromEntries(uriMap),
                });
            }
        });
    }

    private _getOrCreateUriMap(uriKey: string): Map<string, string> {
        let uriMap = this._imageUriMaps.get(uriKey);
        if (!uriMap) {
            uriMap = new Map<string, string>();
            this._imageUriMaps.set(uriKey, uriMap);
        }
        return uriMap;
    }

    private async _handleOpenFile(targetPath: string | undefined, document: MarkdownDocument): Promise<void> {
        if (!targetPath) return;

        const hashIdx = targetPath.indexOf("#");
        const filePath = hashIdx >= 0 ? targetPath.slice(0, hashIdx) : targetPath;
        const fragment = hashIdx >= 0 ? targetPath.slice(hashIdx + 1) : undefined;
        const lineMatch = fragment?.match(/^(\d+)(-\d+)?$/);
        const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

        let absPath: string;
        if (filePath.startsWith("@/")) {
            const docFsPath = document.uri.fsPath;
            const sep = path.sep;
            const containingFolder = vscode.workspace.workspaceFolders?.find(
                f => docFsPath.startsWith(f.uri.fsPath + sep),
            );
            const workspaceRoot =
                containingFolder?.uri.fsPath ??
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            absPath = workspaceRoot
                ? path.join(workspaceRoot, filePath.slice(2))
                : path.resolve(path.dirname(docFsPath), "..", filePath.slice(2));
        } else {
            const docDir = path.dirname(document.uri.fsPath);
            absPath = path.resolve(docDir, filePath);
        }

        const targetUri = vscode.Uri.file(absPath);
        if (/\.(md|markdown)$/i.test(absPath)) {
            if (lineNumber !== undefined) {
                this.setPendingNavigation(absPath, lineNumber);
            }
            await vscode.commands.executeCommand(
                "vscode.openWith",
                targetUri,
                MarkdownEditorProvider.viewType,
                { preview: true },
            );
        } else if (lineNumber !== undefined) {
            const doc = await vscode.workspace.openTextDocument(targetUri);
            await vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0),
                preview: true,
            });
        } else {
            vscode.commands.executeCommand("vscode.open", targetUri);
        }
    }

    private async _handleSwitchToTextEditor(line: number | undefined, document: MarkdownDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        this.suppressNavFromTextEditor();
        MarkdownEditorProvider.suppressAutoSwitch.add(document.uri.toString());
        setTimeout(() => MarkdownEditorProvider.suppressAutoSwitch.delete(document.uri.toString()), AUTO_SWITCH_SUPPRESS_DURATION_MS);

        const textDoc = await vscode.workspace.openTextDocument(document.uri);
        const viewCol = webviewPanel.viewColumn;

        let isPreview = false;
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (
                    tab.input instanceof vscode.TabInputCustom &&
                    (tab.input as vscode.TabInputCustom).uri.toString() === document.uri.toString()
                ) {
                    isPreview = tab.isPreview;
                    break;
                }
            }
        }

        const opts: vscode.TextDocumentShowOptions = {
            viewColumn: viewCol,
            preview: isPreview,
            preserveFocus: false,
        };
        if (line && line > 0) {
            const pos = new vscode.Position(line - 1, 0);
            opts.selection = new vscode.Range(pos, pos);
        }

        webviewPanel.dispose();
        await vscode.window.showTextDocument(textDoc, opts);
    }

    private _scheduleAutoSaveOrMarkDirty(document: MarkdownDocument): void {
        const config = vscode.workspace.getConfiguration("epytor");
        const autoSave = config.get<boolean>("autoSave", true);
        const delay = config.get<number>("autoSaveDelay", 1000);
        const uriKey = document.uri.toString();

        if (autoSave) {
            const existing = this._autoSaveTimers.get(uriKey);
            if (existing !== undefined) {
                clearTimeout(existing);
            }
            this._autoSaveTimers.set(
                uriKey,
                setTimeout(async () => {
                    this._autoSaveTimers.delete(uriKey);
                    const cts = new vscode.CancellationTokenSource();
                    try {
                        await document.save(cts.token);
                        DocumentSyncService.recordSavedContent(uriKey, document.getText());
                        const panel = this._webviewPanels.get(uriKey);
                        if (panel) {
                            panel.webview.postMessage({ type: "lineMapUpdate", lineMap: computeLineMap(document.getText()) });
                        }
                    } finally {
                        cts.dispose();
                    }
                }, delay),
            );
        } else {
            this._onDidChangeCustomDocument.fire({
                document,
                label: "Edit",
                undo: () => {},
                redo: () => {},
            });
        }
    }

    async saveCustomDocument(
        document: MarkdownDocument,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        const uriKey = document.uri.toString();
        const timer = this._autoSaveTimers.get(uriKey);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._autoSaveTimers.delete(uriKey);
        }
        await document.save(cancellation);
        DocumentSyncService.recordSavedContent(uriKey, document.getText());
        const panel = this._webviewPanels.get(uriKey);
        if (panel) {
            panel.webview.postMessage({ type: "lineMapUpdate", lineMap: computeLineMap(document.getText()) });
        }
    }

    async saveCustomDocumentAs(
        document: MarkdownDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        await document.saveAs(destination, cancellation);
    }

    async revertCustomDocument(
        document: MarkdownDocument,
        cancellation: vscode.CancellationToken,
    ): Promise<void> {
        await document.revert(cancellation);
        const uriKey = document.uri.toString();
        DocumentSyncService.recordSavedContent(uriKey, document.getText());
        const panel = this._webviewPanels.get(uriKey);
        if (panel) {
            const revertContent = document.getText();
            const displayContent = this._prepareContentForDisplay(revertContent, document, panel, uriKey);
            const uriMap = this._getOrCreateUriMap(uriKey);
            panel.webview.postMessage({
                type: "revert",
                content: displayContent,
                lineMap: computeLineMap(revertContent),
                frontmatter: this._frontmatterMap.get(uriKey) || undefined,
                imageUriMap: Object.fromEntries(uriMap),
            });
        }
    }

    async backupCustomDocument(
        document: MarkdownDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken,
    ): Promise<vscode.CustomDocumentBackup> {
        return document.backup(context.destination, cancellation);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const cfg = vscode.workspace.getConfiguration("epytor");
        const maxHeight = cfg.get<number>("codeBlockMaxHeight", 500);
        const editorMaxWidth = cfg.get<number>("editorMaxWidth", 900);
        const fontFamily = cfg.get<string>("fontFamily", "");
        const imageSelectionColor = cfg.get<string>("imageSelectionColor", "rgba(52, 211, 153, 0.6)");
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
        );
        const nonce = getNonce();

        const lang = vscode.env.language.toLowerCase();
        const isMac = process.platform === 'darwin';
        const translations = lang.startsWith('zh') ? ZH_CN_WEBVIEW : {};
        const debugMode = cfg.get<boolean>("debugMode", false);
        const tableWrapMode = cfg.get<string>("tableWrapMode", "wrap");
        const i18nScript = `window.__i18n=${JSON.stringify({ translations, isMac, debugMode, tableWrapMode })};`;

        return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}' ${webview.cspSource};
             img-src ${webview.cspSource} https: data: blob:;
             media-src ${webview.cspSource} https: data: blob:;
             frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https: data: blob:;
             child-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https: data: blob:;
             connect-src ${webview.cspSource} https: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Editor</title>
  <link rel="stylesheet" href="${styleUri}">
  <style>:root { --code-block-max-height: ${maxHeight}px; --editor-max-width: ${editorMaxWidth}px;${fontFamily ? ` --custom-font-family: ${fontFamily};` : ''} --image-selection-color: ${imageSelectionColor}; }</style>
</head>
<body class="${tableWrapMode === 'nowrap' ? 'epytor-table-nowrap' : 'epytor-table-wrap'}">
  <div class="editor-topbar"></div>
  <div id="editor"></div>
  <script nonce="${nonce}">${i18nScript}</script>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _prepareContentForDisplay(
        content: string,
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        uriKey: string,
    ): string {
        const { frontmatter, body } = extractFrontmatter(content);
        this._frontmatterMap.set(uriKey, frontmatter);
        content = body;

        if (document.uri.scheme !== 'file') { return content; }
        const mdDir = path.dirname(document.uri.fsPath);
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
            ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const uriMap = this._getOrCreateUriMap(uriKey);
        return content.replace(/!\[([^\]]*)\]\(([^)\s"]+)/g, (match, alt, src) => {
            if (/^(https?:|data:|vscode-resource:|vscode-webview-)/.test(src)) { return match; }
            try {
                let absPath: string;
                if (src.startsWith('@/')) {
                    const root = workspaceRoot ?? mdDir;
                    absPath = path.join(root, src.slice(2));
                } else {
                    absPath = path.resolve(mdDir, src);
                }
                const webviewUri = panel.webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
                uriMap.set(webviewUri, src);
                return `![${alt}](${webviewUri}`;
            } catch {
                return match;
            }
        });
    }

    private _prepareContentForSave(content: string, uriKey: string): string {
        const frontmatter = this._frontmatterMap.get(uriKey) ?? "";
        const uriMap = this._getOrCreateUriMap(uriKey);
        return restoreContentForSave(content, frontmatter, uriMap);
    }
}
