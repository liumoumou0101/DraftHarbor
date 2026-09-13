(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborManuscriptFormat = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const INDENT = '\u3000\u3000';
    const CJK_LETTER = /[\u3400-\u9fff\uf900-\ufaff]/;
    const URL_RE = /https?:\/\/[^\s<>"'）】》]+|www\.[^\s<>"'）】》]+/gi;
    const HALF_TO_FULL = {
        ',': '，',
        '.': '。',
        '!': '！',
        '?': '？',
        ';': '；',
        ':': '：',
        '(': '（',
        ')': '）'
    };

    function defaultOptions(options) {
        const source = options && typeof options === 'object' ? options : {};
        const blankLines = Number(source.blankLines);
        return {
            indent: source.indent !== false,
            punctuation: source.punctuation !== false,
            unwrap: source.unwrap !== false,
            blankLines: blankLines === 1 ? 1 : 0
        };
    }

    function isCjkLetter(ch) {
        return !!ch && CJK_LETTER.test(ch);
    }

    function isDigit(ch) {
        return ch >= '0' && ch <= '9';
    }

    function isSceneBreak(line) {
        const compact = String(line || '').replace(/[\s\u3000]/g, '');
        if (!compact) return false;
        return /^(?:\*{1,8}|＊{1,8}|(?:\*(?:\s*\*){1,7})|※{1,8}|☆{1,8}|●{1,8}|◆{1,8}|■{1,8}|▲{1,8}|~{2,}|～{2,}|—{2,}|─{2,}|-{3,}|={3,})$/.test(compact);
    }

    function isHeading(line) {
        const value = String(line || '').trim();
        return /^(?:#{1,6}\s+\S|第[零〇一二三四五六七八九十百千万0-9]+[章节回卷部篇]|【[^】]+】$)/.test(value);
    }

    function keepUnindented(line) {
        return isSceneBreak(line) || isHeading(line);
    }

    function isTerminalLine(line) {
        if (keepUnindented(line)) return true;
        return /[。！？…—：；」』”）】》]$/.test(line) || /[!?:]$/.test(line);
    }

    function startsNewParagraph(line) {
        return /^[「『“（【《]/.test(line) || keepUnindented(line);
    }

    function neighborNonSpace(text, index, direction) {
        let i = index + direction;
        while (i >= 0 && i < text.length) {
            const ch = text[i];
            if (ch !== ' ' && ch !== '\t' && ch !== '\u3000') return ch;
            i += direction;
        }
        return '';
    }

    function mapOutsideUrls(text, fn) {
        const source = String(text || '');
        let last = 0;
        let out = '';
        source.replace(URL_RE, (match, offset) => {
            out += fn(source.slice(last, offset));
            out += match;
            last = offset + match.length;
            return match;
        });
        out += fn(source.slice(last));
        return out;
    }

    function convertQuotes(text) {
        let open = true;
        let out = '';
        for (let i = 0; i < text.length; i += 1) {
            const ch = text[i];
            if (ch === '"') {
                out += open ? '“' : '”';
                open = !open;
            } else {
                out += ch;
            }
        }
        return out;
    }

    function convertHalfwidthPunct(text) {
        let out = '';
        for (let i = 0; i < text.length; i += 1) {
            const ch = text[i];
            const mapped = HALF_TO_FULL[ch];
            if (!mapped) {
                out += ch;
                continue;
            }
            const prev = neighborNonSpace(text, i, -1);
            const next = neighborNonSpace(text, i, 1);
            const cjkNear = isCjkLetter(prev) || isCjkLetter(next);
            if (ch === '.' || ch === ',') {
                if (cjkNear && !isDigit(prev) && !isDigit(next)) out += mapped;
                else out += ch;
                continue;
            }
            out += cjkNear ? mapped : ch;
        }
        return out;
    }

    function tidySpaces(text) {
        return String(text || '')
            .replace(/[\t\u00a0]+/g, ' ')
            .replace(/ {2,}/g, ' ')
            .replace(/([\u3400-\u9fff\uf900-\ufaff])(?: +([\u3400-\u9fff\uf900-\ufaff]))+/g, (chunk) => chunk.replace(/ /g, ''))
            .replace(/ +([，。！？、；：）』」”】》「『“（【《])/g, '$1')
            .replace(/([，。！？、；：（『「“【《]) +(?=[「『“（【《\u3400-\u9fff\uf900-\ufaff])/g, '$1');
    }

    function normalizePunctuation(text) {
        return mapOutsideUrls(text, (chunk) => tidySpaces(
            convertHalfwidthPunct(
                convertQuotes(
                    chunk
                        .replace(/(?:\.{3,}|。{3,}|…+)/g, '……')
                        .replace(/-{2,}/g, '——')
                )
            )
        ));
    }

    function joinLines(left, right) {
        const a = String(left || '');
        const b = String(right || '');
        if (!a) return b;
        if (!b) return a;
        const prev = a.slice(-1);
        const next = b.charAt(0);
        if (isCjkLetter(prev) && isCjkLetter(next)) return a + b;
        if (/\s/.test(prev) || /\s/.test(next)) return a + b.replace(/^\s+/, '');
        if (/[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b)) return `${a} ${b}`;
        return a + b;
    }

    function collectParagraphs(lines, unwrap) {
        const paragraphs = [];
        let buffer = '';
        const flush = () => {
            if (buffer) paragraphs.push(buffer);
            buffer = '';
        };
        lines.forEach((line) => {
            if (!line) {
                flush();
                return;
            }
            if (!buffer) {
                buffer = line;
                return;
            }
            if (!unwrap || isTerminalLine(buffer) || startsNewParagraph(line) || keepUnindented(buffer)) {
                paragraphs.push(buffer);
                buffer = line;
                return;
            }
            buffer = joinLines(buffer, line);
        });
        flush();
        return paragraphs;
    }

    function formatManuscript(text, options) {
        const opts = defaultOptions(options);
        const original = String(text == null ? '' : text);
        let next = original
            .replace(/\uFEFF|\u200B|\u200C|\u200D|\u2060/g, '')
            .replace(/\r\n|\r/g, '\n');
        if (opts.punctuation) next = normalizePunctuation(next);

        const lines = next.split('\n').map((line) => line.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''));
        const paragraphs = collectParagraphs(lines, opts.unwrap).filter(Boolean);
        const formatted = paragraphs.map((paragraph) => {
            if (!opts.indent || keepUnindented(paragraph)) return paragraph;
            return INDENT + paragraph;
        }).join(opts.blankLines === 1 ? '\n\n' : '\n');

        return {
            text: formatted,
            changed: formatted !== original,
            paragraphCount: paragraphs.length
        };
    }

    return {
        INDENT,
        formatManuscript
    };
});
