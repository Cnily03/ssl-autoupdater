const path = require('path')
const fs = require('fs')

let tsconfig_content = fs.readFileSync(path.resolve(__dirname, 'tsconfig.json'), 'utf8')
const tsconfig = eval(`(${tsconfig_content})`)
const rootDir = path.resolve(__dirname, tsconfig.compilerOptions.rootDir)
const outDir = path.resolve(__dirname, tsconfig.compilerOptions.outDir)

function escapeHtml(str) {
    return str.replace(/[&<>"' \n]/g, function (tag) {
        const lookup = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": "&apos;",
            // " ": "&nbsp;",
        };
        return lookup[tag] || tag;
    });
}

// create template output directory
const templateOutDir = path.resolve(outDir, 'template')
if (!fs.existsSync(templateOutDir)) {
    fs.mkdirSync(templateOutDir, { recursive: true })
} else if (fs.statSync(templateOutDir).isFile()) {
    throw new Error(`"${templateOutDir}" is a file, not a directory`)
}

// get EJS file under template
const templateRootDir = path.resolve(rootDir, 'template')
const templateFiles = fs.readdirSync(templateRootDir).filter(file => file.endsWith('.ejs'))
for (let fn of templateFiles) {
    let content = fs.readFileSync(path.resolve(templateRootDir, fn), 'utf8')
    // <style inject="css/spectre.min.css" escape="false"></style>
    content = content.replace(/<([a-zA-Z\-]+)\s+inject="([^"]+)"\s+escape="([^"]+)"\s*><\/([a-zA-Z\-]+)>/g,
        function (substring, tag, inject, escape, closeTag) {
            let injectFilePath = path.resolve(templateRootDir, inject)
            let injectContent = fs.readFileSync(injectFilePath, 'utf8')
            escape = escape === 'true' || escape === '1'
            if (escape) {
                injectContent = escapeHtml(injectContent)
            }
            return `<${tag}>${injectContent}</${closeTag}>`
        }
    )

    // write to outDir
    let outFilePath = path.resolve(templateOutDir, fn)
    fs.writeFileSync(outFilePath, content, 'utf8')
}