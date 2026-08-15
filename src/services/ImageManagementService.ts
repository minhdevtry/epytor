import * as path from "path";
import * as vscode from "vscode";
import type { MarkdownDocument } from "../MarkdownDocument";
import { saveImageLocally, uploadImageToServer } from "../utils/imageService";

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.ico']);
const CANDIDATE_DIRS = ['images', 'imgs', 'assets/images', 'assets'];

export class ImageManagementService {
    public static async handleImageUpload(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        id: string,
        data: Uint8Array,
        mimeType: string,
        altText: string,
        uriMap: Map<string, string>,
    ): Promise<void> {
        const cfg = vscode.workspace.getConfiguration('epytor', document.uri);
        const storage = cfg.get<string>('imageStorage', 'local');
        try {
            let url: string;
            if (storage === 'server') {
                url = await uploadImageToServer(cfg, data, mimeType, altText);
            } else {
                const { relPath, absUri } = await saveImageLocally(document.uri, cfg, data, mimeType, altText);
                const webviewUri = panel.webview.asWebviewUri(absUri);
                url = webviewUri.toString();
                uriMap.set(url, relPath);
            }
            panel.webview.postMessage({ type: 'imageUploaded', id, url });
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            panel.webview.postMessage({ type: 'imageUploadError', id, error: errMsg });
            vscode.window.showErrorMessage(vscode.l10n.t('Image upload failed: {0}', errMsg));
        }
    }

    public static async handleGetProjectImages(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        id: string,
        uriMap: Map<string, string>,
    ): Promise<void> {
        const cfg = vscode.workspace.getConfiguration('epytor', document.uri);
        const customPath = cfg.get<string>('imageLocalPath', '').trim();

        let targetDir: vscode.Uri | null = null;

        if (customPath) {
            if (path.isAbsolute(customPath)) {
                targetDir = vscode.Uri.file(customPath);
            } else {
                const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                targetDir = wsFolder
                    ? vscode.Uri.joinPath(wsFolder.uri, customPath)
                    : vscode.Uri.joinPath(document.uri, '..', customPath);
            }
        } else if (document.uri.scheme === 'file') {
            const mdDir = vscode.Uri.joinPath(document.uri, '..');
            const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            const searchRoots = wsFolder ? [wsFolder.uri, mdDir] : [mdDir];
            outer: for (const root of searchRoots) {
                for (const candidate of CANDIDATE_DIRS) {
                    const candidateUri = vscode.Uri.joinPath(root, candidate);
                    try {
                        const stat = await vscode.workspace.fs.stat(candidateUri);
                        if (stat.type === vscode.FileType.Directory) {
                            targetDir = candidateUri;
                            break outer;
                        }
                    } catch { /* not found */ }
                }
            }
        }

        const images: Array<{ relPath: string; webviewUri: string; name: string }> = [];

        if (targetDir) {
            const mdDir = document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : '';
            try {
                const entries = await vscode.workspace.fs.readDirectory(targetDir);
                for (const [name, type] of entries) {
                    if (type !== vscode.FileType.File) { continue; }
                    const ext = path.extname(name).toLowerCase();
                    if (!IMAGE_EXTS.has(ext)) { continue; }
                    const fileUri = vscode.Uri.joinPath(targetDir, name);
                    const wvUri = panel.webview.asWebviewUri(fileUri).toString();
                    let relPath = name;
                    if (mdDir) {
                        const rel = path.relative(mdDir, fileUri.fsPath).replace(/\\/g, '/');
                        relPath = rel.startsWith('.') ? rel : './' + rel;
                    }
                    uriMap.set(wvUri, relPath);
                    images.push({ relPath, webviewUri: wvUri, name });
                }
            } catch { /* directory not accessible */ }
        }

        panel.webview.postMessage({ type: 'projectImagesList', id, images });
    }

    public static async handleImageRename(
        document: MarkdownDocument,
        panel: vscode.WebviewPanel,
        id: string,
        webviewUri: string,
        newBasename: string,
        uriMap: Map<string, string>,
    ): Promise<void> {
        const oldRelPath = uriMap.get(webviewUri);
        if (!oldRelPath) {
            panel.webview.postMessage({ type: 'imageRenameError', id, error: 'Image not found in URI map' });
            return;
        }

        try {
            const mdDir = path.dirname(document.uri.fsPath);
            const oldAbsPath = path.resolve(mdDir, oldRelPath);
            const oldUri = vscode.Uri.file(oldAbsPath);

            await vscode.workspace.fs.stat(oldUri);

            const oldExt = path.extname(oldAbsPath);
            const safeBasename = newBasename
                .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
                .replace(/\.+$/, '')
                .trim();
            if (!safeBasename) {
                panel.webview.postMessage({ type: 'imageRenameError', id, error: 'Invalid filename' });
                return;
            }

            const dir = path.dirname(oldAbsPath);
            const targetUri = vscode.Uri.file(path.join(dir, safeBasename + oldExt));

            try {
                await vscode.workspace.fs.stat(targetUri);
                const errMsg = vscode.l10n.t('A file named "{0}" already exists.', safeBasename + oldExt);
                panel.webview.postMessage({ type: 'imageRenameError', id, error: errMsg });
                vscode.window.showErrorMessage(errMsg);
                return;
            } catch { /* Target does not exist, proceed */ }

            await vscode.workspace.fs.rename(oldUri, targetUri);

            const rel = path.relative(mdDir, targetUri.fsPath).replace(/\\/g, '/');
            const newRelPath = rel.startsWith('.') ? rel : './' + rel;
            const newWebviewUri = panel.webview.asWebviewUri(targetUri).toString();

            uriMap.delete(webviewUri);
            uriMap.set(newWebviewUri, newRelPath);

            panel.webview.postMessage({ type: 'imageRenamed', id, oldWebviewUri: webviewUri, newWebviewUri });
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            panel.webview.postMessage({ type: 'imageRenameError', id, error: errMsg });
            vscode.window.showErrorMessage(vscode.l10n.t('Image rename failed: {0}', errMsg));
        }
    }
}
