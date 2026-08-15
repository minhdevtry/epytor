/**
 * Pure-function transformations for Markdown content, shared by MarkdownEditorProvider and the unit tests.
 * These functions do not depend on the VSCode API (no webview.asWebviewUri) and can be tested directly in a Node environment.
 */

/**
 * Extract YAML Frontmatter from Markdown content.
 * Recognizes only the standard leading form (--- ... ---).
 */
export function extractFrontmatter(content: string): { frontmatter: string; body: string } {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (match) {
        return { frontmatter: match[0], body: content.slice(match[0].length) };
    }
    return { frontmatter: "", body: content };
}

/**
 * Restore the webviewUri back to a relative path, and prepend the frontmatter.
 * Pure-function extraction that corresponds to _prepareContentForSave.
 */
export function restoreContentForSave(
    content: string,
    frontmatter: string,
    uriMap: Map<string, string>,
): string {
    let result = frontmatter ? frontmatter + content : content;
    for (const [webviewUri, relPath] of uriMap) {
        result = result.split(webviewUri).join(relPath);
    }
    return result;
}
