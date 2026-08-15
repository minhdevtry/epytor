/**
 * shared/messages.ts
 * The single authoritative source for the two-way message types between the WebView and the extension.
 * Both sides import from here; do not duplicate these definitions inline.
 */

/** Image metadata: disk-relative path + WebView-accessible URI + file name */
export type ProjectImage = {
    relPath: string;
    webviewUri: string;
    name: string;
};

/** Path auto-completion suggestion entry */
export type PathSuggestionItem = {
    path: string;
    isDir: boolean;
    webviewUri?: string;  // Returned only for image files, for thumbnail preview
};

/**
 * WebView → Extension direction.
 * All fields reflect the actual constraints of the sender: any field that the sender is required to provide must not be optional.
 */
export type ToExtensionMessage =
    | { type: "ready" }
    | { type: "update"; content: string }
    | { type: "openUrl"; url: string }
    | { type: "openFile"; path: string }
    | { type: "debug"; message: string }
    | { type: "switchToTextEditor"; line?: number }
    | { type: "openSettings" }
    | { type: "uploadImage"; id: string; data: Uint8Array; mimeType: string; altText: string }
    | { type: "getProjectImages"; id: string }
    | { type: "renameImage"; id: string; webviewUri: string; newBasename: string }
    | { type: "getPathSuggestions"; id: string; query: string }
    | { type: "resolveImagePath"; id: string; relPath: string }
    | { type: "wordCount"; lines: number; words: number; charsNoSpace: number; charsWithSpace: number };

/**
 * Extension → WebView direction.
 * lineMap is optional in init/revert: the extension always sends it, but the WebView side uses `?? []` as a safety net.
 */
export type ToWebviewMessage =
    | { type: "init"; content: string; lineMap?: number[]; scrollToLine?: number; frontmatter?: string; imageUriMap?: Record<string, string> }
    | { type: "revert"; content: string; lineMap?: number[]; frontmatter?: string; imageUriMap?: Record<string, string> }
    | { type: "scrollToLine"; line: number }
    | { type: "lineMapUpdate"; lineMap: number[] }
    | { type: "setDebugMode"; enabled: boolean }
    | { type: "imageUploaded"; id: string; url: string }
    | { type: "imageUploadError"; id: string; error: string }
    | { type: "projectImagesList"; id: string; images: ProjectImage[] }
    | { type: "imageRenamed"; id: string; oldWebviewUri: string; newWebviewUri: string }
    | { type: "imageRenameError"; id: string; error: string }
    | { type: "requestSwitchToTextEditor" }
    | { type: "pathSuggestions"; id: string; items: PathSuggestionItem[] }
    | { type: "imagePathResolved"; id: string; webviewUri: string };
