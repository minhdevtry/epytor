import * as crypto from "crypto";
import * as https from "https";
import * as vscode from "vscode";
import { generateFilename } from "./imageService";

export interface R2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicDomain: string;
    pathPrefix?: string;
}

export function hmacSha256(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

export function sha256Hex(data: Buffer | Uint8Array | string): string {
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
        throw new Error(vscode.l10n.t("Missing Cloudflare R2 configuration (accountId, accessKeyId, secretAccessKey, bucket)"));
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
