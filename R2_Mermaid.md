# Plan & Technical Spec: Cloudflare R2 Image Storage & Mermaid Diagrams Upgrade

> **Document prepared for Agents**: This document contains thorough research, current source code analysis, architectural design, sample source code, and step-by-step checklists. The next agent can read this file and start implementation immediately without re-investigation.

***

## 📑 Table of Contents

1. [Part 1: Cloudflare R2 Image Storage Integration](#part-1-cloudflare-r2-image-storage-integration)

   * [1.1 Current Codebase Survey](#11-current-codebase-survey)
   * [1.2 Configuration Design (package.json)](#12-configuration-design-packagejson)
   * [1.3 Module Design r2Service.ts (Zero-Dependency AWS4 Signer)](#13-module-design-r2servicets-zero-dependency-aws4-signer)
   * [1.4 Integration into ImageManagementService](#14-integration-into-imagemanagementservice)
   * [1.5 Unit Test Strategy](#15-unit-test-strategy)

2. [Part 2: Mermaid Diagrams Upgrade (Visual & Rich Interactivity)](#part-2-mermaid-diagrams-upgrade-visual--rich-interactivity)

   * [2.1 Current Mermaid Survey in Codebase](#21-current-mermaid-survey-in-codebase)
   * [2.2 Modern Aesthetic Theme Engine & Curve Configuration](#22-modern-aesthetic-theme-engine--curve-configuration)
   * [2.3 HD PNG (2x/4x) & Vector SVG Export Tools](#23-hd-png-2x4x--vector-svg-export-tools)
   * [2.4 Smart Interaction: Node Path Highlighting & Document Anchor Navigation](#24-smart-interaction-node-path-highlighting--document-anchor-navigation)
   * [2.5 Toolbar & Modal Zoom/Pan Upgrade](#25-toolbar--modal-zoompan-upgrade)

3. [Step-by-Step Execution Checklist](#step-by-step-execution-checklist)

***

# Part 1: Cloudflare R2 Image Storage Integration

## 1.1 Current Codebase Survey

### Current image handling flow:

1. **WebView Trigger** ([webview/index.ts](webview/index.ts) / [webview/components/imageView/index.ts](webview/components/imageView/index.ts)):

   * User Paste (`Ctrl+V`) or Drag-and-drop image → Send `uploadImage` message via [webview/messaging.ts](webview/messaging.ts) to the Extension Host:

     ```ts
     notifyUploadImage(data: Uint8Array, mimeType: string, altText: string): Promise<string>
     ```

2. **Extension Host Dispatcher** ([src/MarkdownEditorProvider.ts](src/MarkdownEditorProvider.ts) \~L302-L308):

   * Receives the `uploadImage` message and forwards it to `ImageManagementService.handleImageUpload`.

3. **Image Service Core** ([src/services/ImageManagementService.ts](src/services/ImageManagementService.ts) ~L10-L37 & [src/utils/imageService.ts](src/utils/imageService.ts)):

   * Reads config `const storage = cfg.get<string>('imageStorage', 'local')`.
   * If `storage === 'server'`: Calls `uploadImageToServer` (HTTP POST multipart/form-data).
   * If `storage === 'local'`: Saves file to `./assets` or `images/`, generates a `vscode-webview-resource://` URI and stores the `uriMap` mapping.

### R2 integration feasibility assessment:

* **Trivially easy and a great fit for the architecture**: Only need to add an `if (storage === 'r2')` branch in `ImageManagementService.ts` that calls `uploadImageToR2(cfg, data, mimeType, altText)`.
* **No Markdown structure changes needed**: The URL returned from R2 is a public HTTPS URL (e.g. `https://pub-xxx.r2.dev/epytor/image.png` or `https://cdn.domain.com/epytor/image.png`). The WebView renders it directly and Markdown stores the link directly without any internal URI mapping.

***

## 1.2 Configuration Design (package.json)

Add the following configuration fields to `contributes.configuration.properties` in [package.json](package.json):

```json
"epytor.imageStorage": {
  "order": 10,
  "type": "string",
  "enum": ["local", "r2", "server"],
  "enumDescriptions": [
    "%config.imageStorage.local%",
    "%config.imageStorage.r2%",
    "%config.imageStorage.server%"
  ],
  "default": "local",
  "description": "%config.imageStorage.description%"
},
"epytor.r2.accountId": {
  "order": 20,
  "type": "string",
  "default": "",
  "description": "%config.r2.accountId.description%"
},
"epytor.r2.accessKeyId": {
  "order": 21,
  "type": "string",
  "default": "",
  "description": "%config.r2.accessKeyId.description%"
},
"epytor.r2.secretAccessKey": {
  "order": 22,
  "type": "string",
  "default": "",
  "description": "%config.r2.secretAccessKey.description%"
},
"epytor.r2.bucket": {
  "order": 23,
  "type": "string",
  "default": "",
  "description": "%config.r2.bucket.description%"
},
"epytor.r2.publicDomain": {
  "order": 24,
  "type": "string",
  "default": "",
  "description": "%config.r2.publicDomain.description%"
},
"epytor.r2.pathPrefix": {
  "order": 25,
  "type": "string",
  "default": "images/",
  "description": "%config.r2.pathPrefix.description%"
}
```

Add translations to [package.nls.json](package.nls.json) and [package.nls.zh-cn.json](package.nls.zh-cn.json).

***

## 1.3 Module Design `r2Service.ts` (Zero-Dependency AWS4 Signer)

Create new file: `src/utils/r2Service.ts`
Functionality: Sign standard S3 REST API AWS Signature Version 4 requests and upload directly to Cloudflare R2 via native HTTPS.

### AWS4 signing algorithm (S3-compatible):

```ts
import * as crypto from "crypto";
import * as https from "https";
import * as vscode from "vscode";
import { generateFilename, mimeToExt } from "./imageService";

export interface R2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicDomain: string;
    pathPrefix?: string;
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | Uint8Array | string): string {
    return crypto.createHash("sha256").update(data).digest("hex");
}

export function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
    const kDate = hmacSha256("AWS4" + key, dateStamp);
    const kRegion = hmacSha256(kDate, regionName);
    const kService = hmacSha256(kRegion, serviceName);
    return hmacSha256(kService, "aws4_request");
}

/**
 * Upload image buffer to Cloudflare R2 and return the public URL
 */
export async function uploadImageToR2(
    cfg: vscode.WorkspaceConfiguration,
    data: Uint8Array,
    mimeType: string,
    altText: string,
): Promise<string> {
    const accountId = cfg.get<string>("r2.accountId", "").trim();
    const accessKeyId = cfg.get<string>("r2.accessKeyId", "").trim();
    const secretAccessKey = cfg.get<string>("r2.secretAccessKey", "").trim();
    const bucket = cfg.get<string>("r2.bucket", "").trim();
    let publicDomain = cfg.get<string>("r2.publicDomain", "").trim();
    let pathPrefix = cfg.get<string>("r2.pathPrefix", "images/").trim();

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error("Missing Cloudflare R2 configuration (accountId, accessKeyId, secretAccessKey, bucket)");
    }

    if (pathPrefix && !pathPrefix.endsWith("/")) {
        pathPrefix += "/";
    }
    if (pathPrefix.startsWith("/")) {
        pathPrefix = pathPrefix.slice(1);
    }

    const filename = generateFilename(altText, mimeType);
    const objectKey = `${pathPrefix}${filename}`;
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const canonicalUri = `/${bucket}/${objectKey}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8); // YYYYMMDD
    const region = "auto";
    const service = "s3";

    const payloadHash = sha256Hex(data);

    // 1. Canonical Headers
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

    // 2. Canonical Request
    const canonicalRequest = [
        "PUT",
        canonicalUri,
        "", // canonicalQueryString
        canonicalHeaders,
        signedHeaders,
        payloadHash,
    ].join("\n");

    // 3. String to Sign
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join("\n");

    // 4. Calculate Signature
    const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

    // 5. Authorization Header
    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // 6. Execute HTTPS PUT
    await new Promise<void>((resolve, reject) => {
        const req = https.request(
            {
                hostname: host,
                path: canonicalUri,
                method: "PUT",
                headers: {
                    Host: host,
                    "Content-Type": mimeType,
                    "Content-Length": data.byteLength,
                    "x-amz-date": amzDate,
                    "x-amz-content-sha256": payloadHash,
                    Authorization: authorizationHeader,
                },
                timeout: 30000,
            },
            (res) => {
                let responseBody = "";
                res.on("data", (chunk) => (responseBody += chunk));
                res.on("end", () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`R2 Upload failed HTTP ${res.statusCode}: ${responseBody.slice(0, 200)}`));
                    }
                });
            },
        );

        req.on("error", (err) => reject(new Error(`R2 Network Error: ${err.message}`)));
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("R2 Upload timed out (30s)"));
        });

        req.write(Buffer.from(data));
        req.end();
    });

    // 7. Format Public URL
    if (publicDomain) {
        if (!publicDomain.startsWith("http://") && !publicDomain.startsWith("https://")) {
            publicDomain = "https://" + publicDomain;
        }
        publicDomain = publicDomain.replace(/\/+$/, "");
        return `${publicDomain}/${objectKey}`;
    }

    // Fallback if publicDomain is not set
    return `https://${bucket}.${accountId}.r2.cloudflarestorage.com/${objectKey}`;
}
```

***

## 1.4 Integration into ImageManagementService

In [src/services/ImageManagementService.ts](src/services/ImageManagementService.ts):

```ts
import { uploadImageToR2 } from "../utils/r2Service";

// In the handleImageUpload method:
const storage = cfg.get<string>('imageStorage', 'local');
try {
    let url: string;
    if (storage === 'r2') {
        url = await uploadImageToR2(cfg, data, mimeType, altText);
    } else if (storage === 'server') {
        url = await uploadImageToServer(cfg, data, mimeType, altText);
    } else {
        const { relPath, absUri } = await saveImageLocally(document.uri, cfg, data, mimeType, altText);
        const webviewUri = panel.webview.asWebviewUri(absUri);
        url = webviewUri.toString();
        uriMap.set(url, relPath);
    }
    panel.webview.postMessage({ type: 'imageUploaded', id, url });
}
```

***

## 1.5 Unit Test Strategy

Create file `src/__tests__/r2Service.test.ts`:

1. `getSignatureKey`: Verify the HMAC-SHA256 chain matches the AWS SigV4 test vectors.

2. `uploadImageToR2`: Mock `https.request` and confirm:

   * `Authorization` header format is `AWS4-HMAC-SHA256 Credential=...`.
   * `x-amz-content-sha256` matches the payload hash.
   * Returns the correct public URL when status code is 200/204.
   * Throws detailed errors on HTTP 403 (Invalid credentials) or HTTP 404 (Bucket not found).

***

# Part 2: Mermaid Diagrams Upgrade (Visual & Rich Interactivity)

## 2.1 Current Mermaid Survey in Codebase

* **Library**: `mermaid` version `^11.16.1` in [package.json](package.json) \~L244.
* **Initialization site**: [webview/editor.ts](webview/editor.ts) \~L328-L403.
* **Theme Bus**: [webview/utils/themeBus.ts](webview/utils/themeBus.ts) listens for Dark/Light theme changes.
* **Modal Popup**: [webview/ui/modals/mermaidZoomModal.ts](webview/ui/modals/mermaidZoomModal.ts) (supports drag-to-pan, scroll-to-zoom, Copy Code button).

***

## 2.2 Modern Aesthetic Theme Engine & Curve Configuration

### Create theme module: `webview/utils/mermaidThemes.ts`

Mermaid v11 provides powerful `themeVariables` for detailed per-component customization:

```ts
import type { MermaidConfig } from "mermaid";

export function getMermaidConfig(isDark: boolean): MermaidConfig {
    return {
        startOnLoad: false,
        securityLevel: "loose",
        fontFamily: "var(--vscode-editor-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
        theme: "base",
        themeVariables: isDark ? {
            // Dark mode theme variables (modern, high-contrast, premium HSL palette)
            darkMode: true,
            background: "transparent",
            primaryColor: "#1e293b",
            primaryTextColor: "#f1f5f9",
            primaryBorderColor: "#475569",
            lineColor: "#94a3b8",
            secondaryColor: "#334155",
            tertiaryColor: "#0f172a",
            noteBkgColor: "#1e293b",
            noteTextColor: "#f8fafc",
            noteBorderColor: "#64748b",
            actorBkg: "#1e293b",
            actorTextColor: "#f8fafc",
            actorBorder: "#3b82f6",
            signalColor: "#94a3b8",
            signalTextColor: "#f1f5f9",
            clusterBkg: "rgba(30, 41, 59, 0.5)",
            clusterBorder: "#475569",
            edgeLabelBackground: "#0f172a",
            nodeBorder: "#3b82f6",
            mainBkg: "#1e293b",
        } : {
            // Light mode theme variables (clean, neat, easy-on-the-eye pastel colors)
            darkMode: false,
            background: "transparent",
            primaryColor: "#f8fafc",
            primaryTextColor: "#0f172a",
            primaryBorderColor: "#cbd5e1",
            lineColor: "#64748b",
            secondaryColor: "#f1f5f9",
            tertiaryColor: "#ffffff",
            noteBkgColor: "#fef9c3",
            noteTextColor: "#713f12",
            noteBorderColor: "#fde047",
            actorBkg: "#f8fafc",
            actorTextColor: "#0f172a",
            actorBorder: "#3b82f6",
            signalColor: "#64748b",
            signalTextColor: "#0f172a",
            clusterBkg: "rgba(241, 245, 249, 0.6)",
            clusterBorder: "#cbd5e1",
            edgeLabelBackground: "#ffffff",
            nodeBorder: "#2563eb",
            mainBkg: "#ffffff",
        },
        flowchart: {
            curve: "basis", // Smooth Monotone / Basis curve, replacing the angular polyline
            htmlLabels: true,
            padding: 18,
            nodeSpacing: 50,
            rankSpacing: 50,
        },
        sequence: {
            diagramMarginX: 20,
            diagramMarginY: 20,
            actorMargin: 50,
            width: 150,
            height: 45,
            boxMargin: 10,
            boxTextMargin: 5,
            noteMargin: 10,
            messageMargin: 35,
            mirrorActors: false,
        },
        er: {
            diagramPadding: 20,
            layoutDirection: "TB",
            entityPadding: 15,
        },
        state: {
            dividerMargin: 10,
            sizeUnit: 5,
        },
    };
}
```

***

## 2.3 HD PNG (2x/4x) & Vector SVG Export Tools

Create helper `webview/utils/mermaidExport.ts`:

```ts
/**
 * Export rendered SVG element to high-resolution PNG image
 */
export async function exportSvgToPng(svgElement: SVGSVGElement, scale: number = 2): Promise<Blob> {
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = svgElement.clientWidth * scale || 1200 * scale;
    canvas.height = svgElement.clientHeight * scale || 800 * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob!), "image/png");
    });
}

/**
 * Copy PNG image directly to system clipboard
 */
export async function copyPngToClipboard(svgElement: SVGSVGElement): Promise<void> {
    const blob = await exportSvgToPng(svgElement, 2);
    await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
    ]);
}
```

***

## 2.4 Smart Interaction: Node Path Highlighting & Document Anchor Navigation

### CSS animation & highlight rules ([webview/style.css](webview/style.css)):

```css
/* Mermaid Interactive Nodes */
.mermaid-rendered-svg .node {
    cursor: pointer;
    transition: transform 0.15s ease, filter 0.15s ease, opacity 0.2s ease;
}

.mermaid-rendered-svg .node:hover {
    filter: drop-shadow(0 0 6px rgba(59, 130, 246, 0.6));
    transform: scale(1.02);
}

.mermaid-rendered-svg .edgePath {
    transition: stroke-width 0.2s ease, stroke 0.2s ease, opacity 0.2s ease;
}

.mermaid-rendered-svg.has-focus .node:not(.is-focused),
.mermaid-rendered-svg.has-focus .edgePath:not(.is-focused) {
    opacity: 0.25;
}

.mermaid-rendered-svg .edgePath.is-focused path {
    stroke: #3b82f6 !important;
    stroke-width: 3px !important;
}
```

### Event delegation logic in [webview/editor.ts](webview/editor.ts):

* On hover over a `.node[id]`:

  * Find all edges whose class links to that ID.
  * Add the `is-focused` class to the node and related edges; add the `has-focus` class to the wrapper.

* On click of a `.node`:

  * Read the text inside the node.
  * Find a Heading in the document with similar text and smoothly scroll to its position.

***

## 2.5 Toolbar & Modal Zoom/Pan Upgrade

1. **Toolbar on the Mermaid block**:

   * `[🔍 Zoom]` (open the modal canvas)
   * `[📋 Copy PNG]` (export 2x crisp PNG to the clipboard)
   * `[📋 Copy Code]` (copy the Mermaid source)

2. **Modal zoom canvas** ([webview/ui/modals/mermaidZoomModal.ts](webview/ui/modals/mermaidZoomModal.ts)):

   * Add **Export HD PNG** and **Export SVG** buttons.
   * Support the keyboard shortcuts `+`, `-`, `0` (Reset), `F` (Fit screen), `Esc` (Close).

***

# Step-by-Step Execution Checklist

Each task below is an independent unit of work, strictly following the commit convention in [AGENTS.md](AGENTS.md):

### 🎯 Group 1: Cloudflare R2 Image Upload

* [ ] **Task 1.1**: Declare the `epytor.imageStorage: 'r2'` and `epytor.r2.*` settings in `package.json`, `package.nls.json`, `package.nls.zh-cn.json`.
* [ ] **Task 1.2**: Write `src/utils/r2Service.ts` with the AWS SigV4 REST PUT upload signing function.
* [ ] **Task 1.3**: Write unit tests in `src/__tests__/r2Service.test.ts` (test coverage ≥ 90%).
* [ ] **Task 1.4**: Update `src/services/ImageManagementService.ts` to integrate the `uploadImageToR2` call.
* [ ] **Task 1.5**: Run `pnpm build && pnpm test` to confirm the full test suite passes.
* [ ] **Task 1.6**: Git commit: `feat: add Cloudflare R2 image hosting and S3 signed direct upload support`.

### 🎯 Group 2: Mermaid Diagrams Upgrade

* [ ] **Task 2.1**: Create `webview/utils/mermaidThemes.ts` with the modern theme configuration, HSL palette and Bezier curve `curve: basis`.
* [ ] **Task 2.2**: Create `webview/utils/mermaidExport.ts` supporting HD PNG 2x/4x export and Copy PNG to clipboard.
* [ ] **Task 2.3**: Upgrade the Mermaid block toolbar in `webview/editor.ts` (add Copy PNG, Zoom, Copy Code buttons using vector SVG icons).
* [ ] **Task 2.4**: Add hover focus path and click-to-anchor interaction in `webview/editor.ts` and `webview/style.css`.
* [ ] **Task 2.5**: Upgrade `webview/ui/modals/mermaidZoomModal.ts` to support PNG/SVG export and canvas keyboard shortcuts.
* [ ] **Task 2.6**: Run `pnpm build && pnpm test` to confirm the full test suite passes.
* [ ] **Task 2.7**: Git commit: `feat: upgrade Mermaid visual themes, smooth curves, interactive highlight, and HD PNG export`.

![](https://r2.2tocom.space/images/image_msuobbm2_8zz3.png)
