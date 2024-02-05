const crypto = require("crypto");
const ansiHTML = require('ansi-html');
require('colors');

function escapeHtml(str) {
    return str.replace(/[&<>"' \n]/g, function (tag) {
        const lookup = {
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

function ansi2html(str) {
    ansiHTML.setColors({
        reset: ['50596c', 'f8f9fa'],
    })
    return ansiHTML(escapeHtml(str))
        .replace(/<span style="font-weight:normal;opacity:1;color:#50596c;background:#f8f9fa;">/g, "<span>")
        .replace(/(<\/span>)([^<]+)(<span>)/g, "$1<span>$2</span>$3")
        .replace(/^([^<]+)/g, "<span>$1</span>")
        .replace(/([^>]+)$/g, "<span>$1</span>")
}

function sha256(str) {
    let hash = crypto.createHash("sha256");
    hash.update(str);
    return hash.digest("hex");
}

function hmacSha1(str, secretKey) {
    let hmac = crypto.createHmac("sha1", secretKey);
    hmac.update(str);
    return hmac.digest("base64");
}

module.exports = {
    escapeHtml,
    ansi2html,
    sha256,
    hmacSha1
}