'use strict';

const JSZip = require('jszip');
const path = require('path');

const DEFAULT_LIMITS = Object.freeze({
    maxArchiveBytes: 64 * 1024 * 1024,
    maxEntries: 2000,
    maxEntryBytes: 16 * 1024 * 1024,
    maxTotalUncompressedBytes: 96 * 1024 * 1024,
    maxMarkupBytes: 8 * 1024 * 1024,
    maxXmlNodes: 50000,
    maxXmlDepth: 100
});

const BLOCK_TAGS = new Map([
    ['p', 'paragraph'],
    ['div', 'paragraph'],
    ['section', 'paragraph'],
    ['article', 'paragraph'],
    ['blockquote', 'paragraph'],
    ['li', 'paragraph'],
    ['dd', 'paragraph'],
    ['dt', 'paragraph'],
    ['tr', 'paragraph'],
    ['pre', 'code'],
    ['h1', 'heading'],
    ['h2', 'heading'],
    ['h3', 'heading'],
    ['h4', 'heading'],
    ['h5', 'heading'],
    ['h6', 'heading']
]);

const BLOCKED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'canvas', 'form']);
function asBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    throw new Error('EPUB bytes must be a byte array');
}

function cleanString(value, fallback = '') {
    return String(value === undefined || value === null ? fallback : value).trim();
}

function localName(name) {
    return cleanString(name).split(':').pop().toLowerCase();
}

function decodeEntities(value) {
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
        const normalized = entity.toLowerCase();
        if (normalized === 'amp') return '&';
        if (normalized === 'lt') return '<';
        if (normalized === 'gt') return '>';
        if (normalized === 'quot') return '"';
        if (normalized === 'apos') return "'";
        const codePoint = normalized.startsWith('#x')
            ? Number.parseInt(normalized.slice(2), 16)
            : Number.parseInt(normalized.slice(1), 10);
        return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : match;
    });
}

function findTagEnd(source, start) {
    let quote = '';
    for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        if (quote) {
            if (character === quote) quote = '';
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '>') {
            return index;
        }
    }
    return -1;
}

function parseAttributes(source) {
    const attributes = {};
    let index = 0;
    while (index < source.length) {
        while (/\s/.test(source[index] || '')) index += 1;
        if (index >= source.length || source[index] === '/') break;
        const nameStart = index;
        while (index < source.length && !/[\s=/>]/.test(source[index])) index += 1;
        const name = source.slice(nameStart, index);
        if (!name) break;
        while (/\s/.test(source[index] || '')) index += 1;
        let value = '';
        if (source[index] === '=') {
            index += 1;
            while (/\s/.test(source[index] || '')) index += 1;
            const quote = source[index];
            if (quote === '"' || quote === "'") {
                index += 1;
                const valueStart = index;
                while (index < source.length && source[index] !== quote) index += 1;
                value = source.slice(valueStart, index);
                if (source[index] === quote) index += 1;
            } else {
                const valueStart = index;
                while (index < source.length && !/[\s>]/.test(source[index])) index += 1;
                value = source.slice(valueStart, index);
            }
        }
        attributes[localName(name)] = decodeEntities(value);
    }
    return attributes;
}

function parseXml(source, limits) {
    const xml = String(source || '');
    if (Buffer.byteLength(xml, 'utf8') > limits.maxMarkupBytes) throw new Error('EPUB XML entry is too large');
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('EPUB XML entities are not allowed');
    const root = { name: '#document', attributes: {}, children: [], text: '' };
    const stack = [root];
    let nodeCount = 0;
    let index = 0;

    function addNode(node) {
        stack[stack.length - 1].children.push(node);
        nodeCount += 1;
        if (nodeCount > limits.maxXmlNodes) throw new Error('EPUB XML contains too many nodes');
    }

    while (index < xml.length) {
        const open = xml.indexOf('<', index);
        if (open < 0) {
            stack[stack.length - 1].text += decodeEntities(xml.slice(index));
            break;
        }
        if (open > index) stack[stack.length - 1].text += decodeEntities(xml.slice(index, open));
        if (xml.startsWith('<!--', open)) {
            const end = xml.indexOf('-->', open + 4);
            if (end < 0) throw new Error('EPUB XML comment is unterminated');
            index = end + 3;
            continue;
        }
        if (xml.startsWith('<![CDATA[', open)) {
            const end = xml.indexOf(']]>', open + 9);
            if (end < 0) throw new Error('EPUB XML CDATA is unterminated');
            stack[stack.length - 1].text += xml.slice(open + 9, end);
            index = end + 3;
            continue;
        }
        if (xml.startsWith('<?', open)) {
            const end = xml.indexOf('?>', open + 2);
            if (end < 0) throw new Error('EPUB XML processing instruction is unterminated');
            index = end + 2;
            continue;
        }
        const end = findTagEnd(xml, open + 1);
        if (end < 0) throw new Error('EPUB XML tag is unterminated');
        const raw = xml.slice(open + 1, end).trim();
        if (raw.startsWith('!')) throw new Error('EPUB XML declaration is not allowed');
        if (raw.startsWith('/')) {
            const closingName = localName(raw.slice(1).trim());
            const current = stack.pop();
            if (!current || localName(current.name) !== closingName) throw new Error('EPUB XML tags are not balanced');
        } else {
            const selfClosing = /\/\s*$/.test(raw);
            const content = raw.replace(/\/\s*$/, '').trim();
            const nameMatch = content.match(/^([^\s/>]+)/);
            if (!nameMatch) throw new Error('EPUB XML tag name is invalid');
            const name = nameMatch[1];
            const node = { name, attributes: parseAttributes(content.slice(name.length)), children: [], text: '' };
            addNode(node);
            if (!selfClosing) {
                if (stack.length >= limits.maxXmlDepth) throw new Error('EPUB XML nesting is too deep');
                stack.push(node);
            }
        }
        index = end + 1;
    }
    if (stack.length !== 1) throw new Error('EPUB XML tags are not balanced');
    return root;
}

function findElements(node, wanted) {
    const result = [];
    function visit(current) {
        for (const child of current.children || []) {
            if (localName(child.name) === wanted) result.push(child);
            visit(child);
        }
    }
    visit(node);
    return result;
}

function nodeText(node) {
    return [node.text || '', ...(node.children || []).map(nodeText)].join('');
}

function safeArchivePath(value) {
    const raw = cleanString(value);
    if (!raw || raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
        throw new Error(`EPUB archive path is unsafe: ${raw || '(empty)'}`);
    }
    const parts = raw.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`EPUB archive path is unsafe: ${raw}`);
    return parts.join('/');
}

function resolveInternalPath(basePath, href) {
    const raw = cleanString(href);
    if (!raw) throw new Error('EPUB resource href is empty');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return { remote: true, path: raw };
    const withoutFragment = raw.split('#', 1)[0].split('?', 1)[0];
    let decoded;
    try {
        decoded = decodeURIComponent(withoutFragment);
    } catch {
        throw new Error(`EPUB resource href is not valid: ${raw}`);
    }
    if (decoded.startsWith('/') || /^[A-Za-z]:/.test(decoded)) throw new Error(`EPUB resource href is unsafe: ${raw}`);
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(basePath), decoded));
    if (joined === '..' || joined.startsWith('../') || joined.startsWith('/')) throw new Error(`EPUB resource href escapes the archive: ${raw}`);
    return { remote: false, path: safeArchivePath(joined) };
}

function entrySize(entry) {
    return Number(entry && entry._data && entry._data.uncompressedSize) || 0;
}

function makeLimits(options) {
    return Object.fromEntries(Object.keys(DEFAULT_LIMITS).map((key) => {
        const requested = Number(options[key]);
        return [key, Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_LIMITS[key]];
    }));
}

async function readEntryText(entry, limits, label) {
    const size = entrySize(entry);
    if (size > limits.maxEntryBytes || size > limits.maxMarkupBytes) throw new Error(`EPUB ${label} entry is too large`);
    return entry.async('string');
}

function parseXhtml(source, basePath, entryNames, limits, chapterIndex) {
    if (Buffer.byteLength(source, 'utf8') > limits.maxMarkupBytes) throw new Error('EPUB XHTML entry is too large');
    const blocks = [];
    const warnings = new Set();
    const stack = [];
    let current = null;
    let blockedDepth = 0;
    let headDepth = 0;
    let titleDepth = 0;
    let pageTitle = '';

    function flush() {
        if (!current) return;
        const text = current.text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
        if (text) blocks.push({
            blockId: `chapter-${chapterIndex + 1}-block-${blocks.length + 1}`,
            type: current.type,
            text,
            order: blocks.length
        });
        current = null;
    }

    function append(value, preserveWhitespace = false) {
        const text = decodeEntities(value);
        if (!text) return;
        if (titleDepth > 0) pageTitle += text;
        if (headDepth > 0 || blockedDepth > 0) return;
        if (!current) current = { type: 'paragraph', text: '' };
        current.text += preserveWhitespace ? text : text.replace(/\s+/g, ' ');
    }

    function addImage(attributes) {
        flush();
        const sourcePath = cleanString(attributes.src);
        const alt = cleanString(attributes.alt, '插图').replace(/\s+/g, ' ');
        let resource;
        try {
            resource = resolveInternalPath(basePath, sourcePath);
        } catch {
            warnings.add('unsafe-local-resource');
        }
        if (!sourcePath || !resource || resource.remote) {
            warnings.add('remote-resource-stripped');
            return;
        }
        if (!entryNames.has(resource.path)) {
            warnings.add('missing-local-resource');
            return;
        }
        blocks.push({
            blockId: `chapter-${chapterIndex + 1}-block-${blocks.length + 1}`,
            type: 'paragraph',
            text: `图片：${alt}`,
            order: blocks.length
        });
    }

    let index = 0;
    while (index < source.length) {
        const open = source.indexOf('<', index);
        if (open < 0) {
            append(source.slice(index), stack.includes('pre'));
            break;
        }
        if (open > index) append(source.slice(index, open), stack.includes('pre'));
        if (source.startsWith('<!--', open)) {
            const end = source.indexOf('-->', open + 4);
            index = end < 0 ? source.length : end + 3;
            continue;
        }
        const end = findTagEnd(source, open + 1);
        if (end < 0) break;
        const raw = source.slice(open + 1, end).trim();
        if (!raw || raw.startsWith('!') || raw.startsWith('?')) {
            index = end + 1;
            continue;
        }
        const closing = raw.startsWith('/');
        const content = raw.replace(/^\//, '').replace(/\/\s*$/, '').trim();
        const nameMatch = content.match(/^([^\s/>]+)/);
        if (!nameMatch) {
            index = end + 1;
            continue;
        }
        const tag = localName(nameMatch[1]);
        const attributes = parseAttributes(content.slice(nameMatch[1].length));
        if (closing) {
            if (BLOCK_TAGS.has(tag)) flush();
            if (tag === 'head') headDepth = Math.max(0, headDepth - 1);
            if (tag === 'title') titleDepth = Math.max(0, titleDepth - 1);
            if (BLOCKED_TAGS.has(tag)) blockedDepth = Math.max(0, blockedDepth - 1);
            const stackIndex = stack.lastIndexOf(tag);
            if (stackIndex >= 0) stack.splice(stackIndex, 1);
        } else if (blockedDepth > 0) {
            if (BLOCKED_TAGS.has(tag)) blockedDepth += 1;
        } else if (BLOCKED_TAGS.has(tag)) {
            flush();
            blockedDepth = 1;
            warnings.add('unsafe-markup-stripped');
        } else if (tag === 'head') {
            headDepth += 1;
            stack.push(tag);
        } else if (tag === 'title') {
            titleDepth += 1;
            stack.push(tag);
        } else if (tag === 'img') {
            addImage(attributes);
        } else if (tag === 'br') {
            append('\n', true);
        } else if (BLOCK_TAGS.has(tag)) {
            flush();
            current = { type: BLOCK_TAGS.get(tag), text: '' };
            stack.push(tag);
        } else if (!['meta', 'link', 'hr', 'input', 'source', 'track', 'wbr'].includes(tag)) {
            stack.push(tag);
        }
        index = end + 1;
    }
    flush();
    return { blocks, title: pageTitle.replace(/\s+/g, ' ').trim(), warnings: [...warnings] };
}

function ensureEntry(entries, name, label) {
    const entry = entries.get(name);
    if (!entry || entry.dir) throw new Error(`EPUB ${label} is missing: ${name}`);
    return entry;
}

async function parseEpub(value, options = {}) {
    const limits = makeLimits(options);
    const bytes = asBuffer(value);
    if (!bytes.length || bytes.length > limits.maxArchiveBytes) throw new Error('EPUB archive is empty or too large');
    let zip;
    try {
        zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
    } catch (error) {
        throw new Error(`EPUB archive is invalid: ${error.message}`);
    }
    const entries = new Map();
    let totalUncompressedBytes = 0;
    for (const [originalName, entry] of Object.entries(zip.files)) {
        const originalArchiveName = entry.unsafeOriginalName || originalName;
        const archiveName = entry.dir ? originalArchiveName.replace(/\/+$/, '') : originalArchiveName;
        if (!archiveName) continue;
        let name;
        try {
            name = safeArchivePath(archiveName);
        } catch (error) {
            throw new Error(error.message);
        }
        if (entries.has(name)) throw new Error(`EPUB archive contains duplicate path: ${name}`);
        const unixPermissions = Number(entry.unixPermissions) || 0;
        if ((unixPermissions & 0xF000) === 0xA000) throw new Error(`EPUB archive contains a symlink: ${name}`);
        if (!entry.dir) {
            const size = entrySize(entry);
            if (size > limits.maxEntryBytes) throw new Error(`EPUB entry is too large: ${name}`);
            totalUncompressedBytes += size;
            if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) throw new Error('EPUB archive expands beyond the safety limit');
        }
        entries.set(name, entry);
    }
    if (entries.size > limits.maxEntries) throw new Error('EPUB archive contains too many entries');
    const mimetype = ensureEntry(entries, 'mimetype', 'mimetype');
    if (mimetype._data && mimetype._data.compression && mimetype._data.compression.magic !== '\0\0') throw new Error('EPUB mimetype must be stored without compression');
    if (entrySize(mimetype) !== Buffer.byteLength('application/epub+zip', 'utf8')) throw new Error('EPUB mimetype is invalid');
    if ((await readEntryText(mimetype, limits, 'mimetype')).trim() !== 'application/epub+zip') throw new Error('EPUB mimetype is invalid');

    const container = parseXml(await readEntryText(ensureEntry(entries, 'META-INF/container.xml', 'container.xml'), limits, 'container.xml'), limits);
    const rootfile = findElements(container, 'rootfile').find((node) => cleanString(node.attributes['full-path']));
    if (!rootfile) throw new Error('EPUB rootfile is missing');
    const rootfilePath = safeArchivePath(rootfile.attributes['full-path']);
    const opf = parseXml(await readEntryText(ensureEntry(entries, rootfilePath, 'OPF'), limits, 'OPF'), limits);
    const manifest = new Map();
    for (const item of findElements(opf, 'item')) {
        const id = cleanString(item.attributes.id);
        const href = cleanString(item.attributes.href);
        if (!id || !href) continue;
        const resolved = resolveInternalPath(rootfilePath, href);
        if (resolved.remote) continue;
        manifest.set(id, {
            id,
            path: resolved.path,
            mediaType: cleanString(item.attributes['media-type']).toLowerCase(),
            properties: cleanString(item.attributes.properties)
        });
    }
    const spine = findElements(opf, 'itemref')
        .map((item) => ({ idref: cleanString(item.attributes.idref), linear: cleanString(item.attributes.linear, 'yes') }))
        .filter((item) => item.idref && item.linear.toLowerCase() !== 'no')
        .map((item) => manifest.get(item.idref))
        .filter((item) => item && (item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html' || /(?:xhtml|html)$/i.test(item.path)));
    const orderedItems = spine.length ? spine : [...manifest.values()].filter((item) => item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html');
    const metadataNode = findElements(opf, 'metadata')[0];
    const titleNode = metadataNode && findElements(metadataNode, 'title')[0];
    const title = cleanString(titleNode && nodeText(titleNode), cleanString(options.fileName, '未命名 EPUB').replace(/\.epub$/i, '')) || '未命名 EPUB';
    const chapters = [];
    const warnings = new Set();
    for (const [index, item] of orderedItems.entries()) {
        const entry = entries.get(item.path);
        if (!entry) {
            warnings.add('missing-spine-document');
            continue;
        }
        const page = parseXhtml(await readEntryText(entry, limits, 'XHTML'), item.path, entries, limits, index);
        page.warnings.forEach((warning) => warnings.add(warning));
        if (!page.blocks.length) continue;
        const heading = page.blocks.find((block) => block.type === 'heading');
        chapters.push({
            chapterId: `chapter-${chapters.length + 1}`,
            title: cleanString(heading && heading.text, page.title || `第 ${chapters.length + 1} 章`) || `第 ${chapters.length + 1} 章`,
            order: chapters.length,
            sourceChapterId: `epub:${item.id}`,
            blocks: page.blocks.map((block, blockIndex) => ({ ...block, blockId: `chapter-${chapters.length + 1}-block-${blockIndex + 1}`, order: blockIndex }))
        });
    }
    const characterCount = chapters.reduce((total, chapter) => total + chapter.blocks.reduce((sum, block) => sum + block.text.length, 0), 0);
    if (!characterCount) warnings.add('empty-content');
    return {
        title,
        chapters,
        characterCount,
        warnings: [...warnings],
        parserVersion: 'reader-epub@1'
    };
}

module.exports = {
    DEFAULT_LIMITS,
    parseEpub,
    safeArchivePath,
    resolveInternalPath
};
