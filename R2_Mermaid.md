# Kế hoạch & Đặc tả Kỹ thuật: Cloudflare R2 Image Storage & Nâng cấp Mermaid Diagrams

> **Tài liệu chuẩn bị cho Agent**: Tài liệu này chứa đầy đủ nghiên cứu chi tiết, phân tích mã nguồn hiện tại, thiết kế kiến trúc, mã nguồn mẫu và checklist từng bước. Agent tiếp theo có thể đọc file này và bắt tay vào triển khai ngay mà không cần khảo sát lại.

---

## 📑 Mục lục
1. [Phần 1: Cloudflare R2 Image Storage Integration](#phần-1-cloudflare-r2-image-storage-integration)
   - [1.1 Khảo sát hiện trạng codebase](#11-khảo-sát-hiện-trạng-codebase)
   - [1.2 Thiết kế cấu hình (package.json)](#12-thiết-kế-cấu-hình-packagejson)
   - [1.3 Thiết kế Module r2Service.ts (Zero-Dependency AWS4 Signer)](#13-thiết-kế-module-r2servicets-zero-dependency-aws4-signer)
   - [1.4 Tích hợp vào ImageManagementService](#14-tích-hợp-vào-imagemanagementservice)
   - [1.5 Chiến lược Unit Test](#15-chiến-lược-unit-test)
2. [Phần 2: Nâng cấp Mermaid Diagrams (Visual & Rich Interactivity)](#phần-2-nâng-cấp-mermaid-diagrams-visual--rich-interactivity)
   - [2.1 Khảo sát hiện trạng Mermaid trong codebase](#21-khảo-sát-hiện-trạng-mermaid-trong-codebase)
   - [2.2 Modern Aesthetic Theme Engine & Curve Configuration](#22-modern-aesthetic-theme-engine--curve-configuration)
   - [2.3 Công cụ xuất ảnh HD PNG (2x/4x) & Vector SVG](#23-công-cụ-xuất-ảnh-hd-png-2x4x--vector-svg)
   - [2.4 Tương tác thông minh: Node Path Highlighting & Document Anchor Navigation](#24-tương-tác-thông-minh-node-path-highlighting--document-anchor-navigation)
   - [2.5 Nâng cấp Toolbar & Modal Zoom/Pan](#25-nâng-cấp-toolbar--modal-zoompan)
3. [Checklist triển khai từng bước (Execution Checklist)](#checklist-triển-khai-từng-bước-execution-checklist)

---

# Phần 1: Cloudflare R2 Image Storage Integration

## 1.1 Khảo sát hiện trạng codebase

### Luồng xử lý ảnh hiện tại:
1. **WebView Trigger** ([webview/index.ts](file:///home/lucas/Documents/code/epytor/webview/index.ts) / [webview/components/imageView/index.ts](file:///home/lucas/Documents/code/epytor/webview/components/imageView/index.ts)):
   - Người dùng Paste (`Ctrl+V`) hoặc Drag-and-drop ảnh → Gửi message `uploadImage` qua [webview/messaging.ts](file:///home/lucas/Documents/code/epytor/webview/messaging.ts) tới Extension Host:
     ```ts
     notifyUploadImage(data: Uint8Array, mimeType: string, altText: string): Promise<string>
     ```
2. **Extension Host Dispatcher** ([src/MarkdownEditorProvider.ts](file:///home/lucas/Documents/code/epytor/src/MarkdownEditorProvider.ts#L302-L308)):
   - Nhận `uploadImage` message và chuyển tới `ImageManagementService.handleImageUpload`.
3. **Image Service Core** ([src/services/ImageManagementService.ts](file:///home/lucas/Documents/code/epytor/src/services/ImageManagementService.ts#L10-L37) & [src/utils/imageService.ts](file:///home/lucas/Documents/code/epytor/src/utils/imageService.ts)):
   - Đọc cấu hình `const storage = cfg.get<string>('imageStorage', 'local')`.
   - Nếu `storage === 'server'`: Gọi `uploadImageToServer` (HTTP POST multipart/form-data).
   - Nếu `storage === 'local'`: Lưu file vào `./assets` hoặc `images/`, sinh URI `vscode-webview-resource://` và lưu mapping `uriMap`.

### Đánh giá tính khả thi khi tích hợp R2:
- **Cực kỳ dễ dàng và vừa vặn với kiến trúc**: Chỉ cần thêm nhánh `if (storage === 'r2')` trong `ImageManagementService.ts`, gọi module `uploadImageToR2(cfg, data, mimeType, altText)`.
- **Không làm thay đổi cấu trúc Markdown**: URL trả về từ R2 là URL HTTPS công khai (vd: `https://pub-xxx.r2.dev/epytor/image.png` hoặc `https://cdn.domain.com/epytor/image.png`), WebView hiển thị trực tiếp và Markdown lưu trực tiếp link này mà không cần map URI nội bộ.

---

## 1.2 Thiết kế cấu hình (package.json)

Thêm các trường cấu hình sau vào `contributes.configuration.properties` trong [package.json](file:///home/lucas/Documents/code/epytor/package.json):

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

Bổ sung translation vào [package.nls.json](file:///home/lucas/Documents/code/epytor/package.nls.json) và [package.nls.zh-cn.json](file:///home/lucas/Documents/code/epytor/package.nls.zh-cn.json).

---

## 1.3 Thiết kế Module `r2Service.ts` (Zero-Dependency AWS4 Signer)

Tạo file mới: `src/utils/r2Service.ts`
Chức năng: Ký request AWS Signature Version 4 chuẩn S3 REST API và upload trực tiếp lên Cloudflare R2 bằng HTTPS native.

### Thuật toán ký AWS4 (S3-compatible):
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

---

## 1.4 Tích hợp vào ImageManagementService

Trong [src/services/ImageManagementService.ts](file:///home/lucas/Documents/code/epytor/src/services/ImageManagementService.ts):

```ts
import { uploadImageToR2 } from "../utils/r2Service";

// Trong method handleImageUpload:
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

---

## 1.5 Chiến lược Unit Test

Tạo file `src/__tests__/r2Service.test.ts`:
1. `getSignatureKey`: Kiểm tra chuỗi HMAC SHA256 tính toán đúng theo test vector của AWS SigV4.
2. `uploadImageToR2`: Mock `https.request` xác nhận:
   - Header `Authorization` có format đúng `AWS4-HMAC-SHA256 Credential=...`.
   - Header `x-amz-content-sha256` trùng với hash của payload.
   - Trả về public URL chính xác khi status code 200/204.
   - Ném lỗi chi tiết khi HTTP 403 (Invalid credentials) hoặc HTTP 404 (Bucket not found).

---

# Phần 2: Nâng cấp Mermaid Diagrams (Visual & Rich Interactivity)

## 2.1 Khảo sát hiện trạng Mermaid trong codebase

- **Thư viện**: `mermaid` version `^11.16.1` trong [package.json](file:///home/lucas/Documents/code/epytor/package.json#L244).
- **Vị trí khởi tạo**: [webview/editor.ts](file:///home/lucas/Documents/code/epytor/webview/editor.ts#L328-L403).
- **Theme Bus**: [webview/utils/themeBus.ts](file:///home/lucas/Documents/code/epytor/webview/utils/themeBus.ts) lắng nghe đổi Dark/Light theme.
- **Modal Popup**: [webview/ui/modals/mermaidZoomModal.ts](file:///home/lucas/Documents/code/epytor/webview/ui/modals/mermaidZoomModal.ts) (hỗ trợ kéo thả pan, zoom bằng con lăn, nút Copy Code).

---

## 2.2 Modern Aesthetic Theme Engine & Curve Configuration

### Tạo module theme: `webview/utils/mermaidThemes.ts`

Mermaid v11 cung cấp `themeVariables` cực mạnh để tùy biến chi tiết từng thành phần:

```ts
import type { MermaidConfig } from "mermaid";

export function getMermaidConfig(isDark: boolean): MermaidConfig {
    return {
        startOnLoad: false,
        securityLevel: "loose",
        fontFamily: "var(--vscode-editor-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
        theme: "base",
        themeVariables: isDark ? {
            // Dark Mode Theme Variables (Hiện đại, tương phản sắc nét, màu sắc HSL cao cấp)
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
            // Light Mode Theme Variables (Sạch sẽ, thanh thoát, màu pastel dịu mắt)
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
            curve: "basis", // Đường cong mượt Monotone / Basis thay vì đường gãy thô
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

---

## 2.3 Công cụ xuất ảnh HD PNG (2x/4x) & Vector SVG

Tạo helper `webview/utils/mermaidExport.ts`:

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

---

## 2.4 Tương tác thông minh: Node Path Highlighting & Document Anchor Navigation

### CSS Animation & Highlight Rules ([webview/style.css](file:///home/lucas/Documents/code/epytor/webview/style.css)):
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

### Event Delegation Logic trong [webview/editor.ts](file:///home/lucas/Documents/code/epytor/webview/editor.ts):
- Khi hover vào một `.node[id]`:
  - Tìm tất cả các edge có class liên kết tới ID đó.
  - Thêm class `is-focused` vào node và các edge liên quan; thêm class `has-focus` vào wrapper.
- Khi click vào `.node`:
  - Lấy text bên trong node.
  - Tìm Heading trong tài liệu có text tương đồng và cuộn mượt tới vị trí đó.

---

## 2.5 Nâng cấp Toolbar & Modal Zoom/Pan

1. **Toolbar trên khối Mermaid**:
   - `[🔍 Phóng to]` (Mở Modal Canvas)
   - `[📋 Copy PNG]` (Xuất ảnh PNG 2x nét căng vào clipboard)
   - `[📋 Copy Code]` (Copy mã nguồn Mermaid)
2. **Modal Zoom Canvas** ([webview/ui/modals/mermaidZoomModal.ts](file:///home/lucas/Documents/code/epytor/webview/ui/modals/mermaidZoomModal.ts)):
   - Bổ sung nút **Export HD PNG** và **Export SVG**.
   - Hỗ trợ phím tắt `+`, `-`, `0` (Reset), `F` (Fit screen), `Esc` (Close).

---

# Checklist triển khai từng bước (Execution Checklist)

Mỗi nhiệm vụ dưới đây là một đầu việc độc lập, tuân thủ nghiêm ngặt quy tắc commit trong [AGENTS.md](file:///home/lucas/Documents/code/epytor/AGENTS.md):

### 🎯 Nhóm 1: Cloudflare R2 Image Upload
- [ ] **Task 1.1**: Khai báo cấu hình `epytor.imageStorage: 'r2'` và `epytor.r2.*` trong `package.json`, `package.nls.json`, `package.nls.zh-cn.json`.
- [ ] **Task 1.2**: Viết `src/utils/r2Service.ts` với hàm ký AWS SigV4 REST PUT upload.
- [ ] **Task 1.3**: Viết Unit Test `src/__tests__/r2Service.test.ts` (test coverage ≥ 90%).
- [ ] **Task 1.4**: Cập nhật `src/services/ImageManagementService.ts` tích hợp gọi `uploadImageToR2`.
- [ ] **Task 1.5**: Chạy `pnpm build && pnpm test` xác nhận pass toàn bộ test suite.
- [ ] **Task 1.6**: Git commit: `feat: add Cloudflare R2 image hosting and S3 signed direct upload support`.

### 🎯 Nhóm 2: Nâng cấp Mermaid Diagrams
- [ ] **Task 2.1**: Tạo `webview/utils/mermaidThemes.ts` với cấu hình theme hiện đại, HSL palette và đường cong Bezier `curve: basis`.
- [ ] **Task 2.2**: Tạo `webview/utils/mermaidExport.ts` hỗ trợ xuất HD PNG 2x/4x và Copy PNG vào Clipboard.
- [ ] **Task 2.3**: Nâng cấp thanh công cụ khối Mermaid trong `webview/editor.ts` (thêm nút Copy PNG, Zoom, Copy Code dùng vector SVG icon).
- [ ] **Task 2.4**: Bổ sung tương tác hover focus path và click-to-anchor trong `webview/editor.ts` và `webview/style.css`.
- [ ] **Task 2.5**: Nâng cấp `webview/ui/modals/mermaidZoomModal.ts` hỗ trợ Export PNG/SVG và phím tắt canvas.
- [ ] **Task 2.6**: Chạy `pnpm build && pnpm test` xác nhận pass toàn bộ.
- [ ] **Task 2.7**: Git commit: `feat: upgrade Mermaid visual themes, smooth curves, interactive highlight, and HD PNG export`.
