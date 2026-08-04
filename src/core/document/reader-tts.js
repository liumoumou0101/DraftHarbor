(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftHarborReaderTts = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const TTS_SCHEMA_VERSION = 1;
    const TTS_STATUSES = Object.freeze(['idle', 'speaking', 'paused', 'stopped', 'completed', 'unsupported', 'error']);
    const DEFAULT_MAX_CHUNK_CHARS = 240;
    const TIMER_MINUTES = Object.freeze([0, 5, 10, 20, 30, 45, 60, 90, 120]);

    function cleanString(value, fallback = '') {
        const text = value === null || value === undefined ? fallback : String(value);
        return text.trim();
    }

    function clamp(value, fallback, minimum, maximum) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
    }

    function normalizeTimerMinutes(value) {
        const number = Math.round(Number(value));
        return TIMER_MINUTES.includes(number) ? number : 0;
    }

    function normalizeReaderTtsSettings(input = {}) {
        return Object.freeze({
            schemaVersion: TTS_SCHEMA_VERSION,
            voiceName: cleanString(input.voiceName),
            rate: Number(clamp(input.rate, 1, 0.5, 2).toFixed(1)),
            volume: Number(clamp(input.volume, 1, 0, 1).toFixed(2)),
            paragraphPauseMs: Math.round(clamp(input.paragraphPauseMs, 350, 0, 3000)),
            autoAdvance: input.autoAdvance !== false,
            timerMinutes: normalizeTimerMinutes(input.timerMinutes),
            maxChunkChars: Math.round(clamp(input.maxChunkChars, DEFAULT_MAX_CHUNK_CHARS, 80, 600))
        });
    }

    function safeChunkBoundary(text, boundary) {
        let end = Math.max(1, Math.min(text.length, boundary));
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
        return Math.max(1, end);
    }

    function splitReaderTtsText(value, maximum = DEFAULT_MAX_CHUNK_CHARS) {
        const text = String(value === null || value === undefined ? '' : value).replace(/\r\n?/g, '\n').trim();
        const maxChars = Math.round(clamp(maximum, DEFAULT_MAX_CHUNK_CHARS, 80, 600));
        const chunks = [];
        let start = 0;
        while (start < text.length) {
            const remaining = text.slice(start);
            if (remaining.length <= maxChars) {
                chunks.push({ text: remaining, startOffset: start, endOffset: text.length });
                break;
            }
            const window = remaining.slice(0, maxChars);
            const punctuation = [...window.matchAll(/[。！？.!?；;\n]/g)].map((match) => match.index + 1).filter((index) => index >= Math.floor(maxChars * 0.45));
            const whitespace = [...window.matchAll(/[\s]/g)].map((match) => match.index + 1).filter((index) => index >= Math.floor(maxChars * 0.55));
            const preferred = punctuation.at(-1) || whitespace.at(-1) || maxChars;
            const end = safeChunkBoundary(text, start + preferred);
            const chunkText = text.slice(start, end).trim();
            if (chunkText) {
                const leading = text.slice(start, end).search(/\S/);
                const adjustedStart = leading < 0 ? start : start + leading;
                chunks.push({ text: chunkText, startOffset: adjustedStart, endOffset: end });
            }
            start = end;
            while (start < text.length && /\s/.test(text[start])) start += 1;
        }
        return chunks;
    }

    function createReaderTtsQueue(chapter, locator, options = {}) {
        const blocks = chapter && Array.isArray(chapter.blocks) ? chapter.blocks : [];
        const foundIndex = blocks.findIndex((block) => block.blockId === (locator && locator.blockId));
        const startBlockIndex = Math.max(0, foundIndex);
        const queue = [];
        blocks.slice(startBlockIndex).forEach((block, relativeIndex) => {
            const isStartBlock = relativeIndex === 0 && locator && locator.blockId === block.blockId;
            const startOffset = isStartBlock ? Math.max(0, Math.min(String(block.text || '').length, Number(locator.offset) || 0)) : 0;
            splitReaderTtsText(String(block.text || '').slice(startOffset), options.maxChunkChars).forEach((chunk, chunkIndex) => {
                queue.push({
                    chapterId: cleanString(chapter.chapterId),
                    blockId: cleanString(block.blockId),
                    blockType: cleanString(block.type, 'paragraph'),
                    chunkIndex,
                    text: chunk.text,
                    startOffset: startOffset + chunk.startOffset,
                    endOffset: startOffset + chunk.endOffset
                });
            });
        });
        return queue;
    }

    function createReaderTtsState(input = {}) {
        const settings = normalizeReaderTtsSettings(input.settings || input);
        return {
            schemaVersion: TTS_SCHEMA_VERSION,
            status: TTS_STATUSES.includes(input.status) ? input.status : 'idle',
            settings,
            chapterId: cleanString(input.chapterId),
            blockId: cleanString(input.blockId),
            offset: Math.max(0, Math.floor(Number(input.offset) || 0)),
            queueIndex: Number.isInteger(input.queueIndex) ? input.queueIndex : -1,
            errorCode: cleanString(input.errorCode),
            remainingSeconds: Math.max(0, Math.floor(Number(input.remainingSeconds) || 0))
        };
    }

    function transitionReaderTts(stateInput, event, changes = {}) {
        const state = createReaderTtsState(stateInput);
        const nextStatus = {
            start: 'speaking',
            pause: 'paused',
            resume: 'speaking',
            stop: 'stopped',
            complete: 'completed',
            unsupported: 'unsupported',
            error: 'error',
            reset: 'idle'
        }[cleanString(event)];
        if (!nextStatus) return state;
        return createReaderTtsState({ ...state, ...changes, status: nextStatus });
    }

    return {
        TTS_SCHEMA_VERSION,
        TTS_STATUSES,
        TIMER_MINUTES,
        normalizeReaderTtsSettings,
        splitReaderTtsText,
        createReaderTtsQueue,
        createReaderTtsState,
        transitionReaderTts
    };
});
