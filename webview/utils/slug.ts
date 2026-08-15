/**
 * GitHub-compatible slugify function.
 *
 * Rules:
 * 1. Lowercase
 * 2. Remove Unicode punctuation, symbols, and emoji (only keep letters, digits, hyphens, underscores, and spaces)
 * 3. Replace spaces with hyphens (do not collapse consecutive hyphens, do not trim leading/trailing hyphens)
 *
 * Examples:
 *   "H2 Section Title"        → "h2-section-title"
 *   "🚀 Emoji Title"          → "-emoji-title"
 *   "Special Chars : and &"   → "special-chars--and-"
 *   "Duplicate Title"         → "duplicate-title"  (caller is responsible for deduping the suffix)
 *
 * The same behavior applies to any Unicode script (Cyrillic, Greek, Arabic, CJK, etc.)
 * because the regex uses \p{L} which matches all Unicode letters.
 */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        // Remove all characters that are not letters, digits, hyphens, underscores, or spaces
        // \p{L} matches all Unicode letters (Cyrillic, Greek, Arabic, CJK, etc.); \p{N} matches Unicode digits
        // This automatically removes emoji, punctuation, etc.
        .replace(/[^\p{L}\p{N}_\- ]/gu, "")
        // space → hyphen (keep duplicates, so "special-chars--and-" etc. can be reproduced)
        .replace(/ /g, "-");
}
