import crypto from "node:crypto";

export type LinkTokenPayload = {
  campaignId: string;
  recipientId: string;
  linkId: string;
  targetUrl: string;
};

function toBase64Url(data: string): string {
  return Buffer.from(data).toString("base64url");
}

export function signLinkPayload(payload: LinkTokenPayload, secret: string): string {
  const raw = JSON.stringify(payload);
  const encoded = toBase64Url(raw);
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function rewriteTrackedLinks(html: string, makeTrackedUrl: (url: string) => string): string {
  return html.replace(/href="([^"]+)"/g, (_all, href: string) => {
    const tracked = makeTrackedUrl(href);
    return `href="${tracked}"`;
  });
}

export function injectTrackingPixel(html: string, pixelUrl: string): string {
  const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none;" alt="" />`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${pixel}</body>`);
  }
  return `${html}${pixel}`;
}
