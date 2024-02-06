import crypto from "crypto"
import ansiHTML from 'ansi-html'
import "colors"

export function escapeHtml(str: string) {
    return str.replace(/[&<>"' \n]/g, function (tag) {
        const lookup: any = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": "&apos;",
            " ": "&nbsp;",
            "\n": "<br/>"
        };
        return lookup[tag] || tag;
    });

}

export function ansi2html(str: string) {
    ansiHTML.setColors({
        reset: ['50596c', 'f8f9fa'],
    })
    return ansiHTML(escapeHtml(str))
        .replace(/<span style="font-weight:normal;opacity:1;color:#50596c;background:#f8f9fa;">/g, "<span>")
        .replace(/(<\/span>)([^<]+)(<span>)/g, "$1<span>$2</span>$3")
        .replace(/^([^<]+)/g, "<span>$1</span>")
        .replace(/([^>]+)$/g, "<span>$1</span>")
}

export function sha256(str: crypto.BinaryLike) {
    let hash = crypto.createHash("sha256");
    hash.update(str);
    return hash.digest("hex");
}

export function hmacSha1(str: crypto.BinaryLike, secretKey: crypto.BinaryLike) {
    let hmac = crypto.createHmac("sha1", secretKey);
    hmac.update(str);
    return hmac.digest("base64");
}