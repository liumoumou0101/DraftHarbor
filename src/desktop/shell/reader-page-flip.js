(function attachReaderPageFlip(global) {
    'use strict';

    let activeSession = null;

    function cloneSpread(deck, size) {
        const pages = Array.from(deck.querySelectorAll(':scope > .desktop-reader-page'))
            .slice(0, size)
            .map((page) => page.cloneNode(true));
        while (pages.length < size) {
            const blank = document.createElement('section');
            blank.className = 'desktop-reader-page desktop-reader-page-flip-blank';
            blank.setAttribute('aria-hidden', 'true');
            pages.push(blank);
        }
        pages.forEach((page) => page.classList.add('desktop-reader-page-flip-sheet'));
        return pages;
    }

    function pageBounds(deck) {
        const pages = Array.from(deck.querySelectorAll(':scope > .desktop-reader-page'));
        if (!pages.length) return null;
        const first = pages[0].getBoundingClientRect();
        const last = pages[pages.length - 1].getBoundingClientRect();
        return {
            left: first.left,
            top: Math.min(first.top, last.top),
            right: last.right,
            bottom: Math.max(first.bottom, last.bottom),
            pageWidth: first.width
        };
    }

    function startReaderPageFlip(options = {}) {
        const PageFlip = global.St && global.St.PageFlip;
        const content = options.content;
        const outgoingDeck = options.outgoingDeck;
        const incomingDeck = options.incomingDeck;
        const host = document.querySelector('[data-reader-page-flip-host]');
        const stage = host && host.closest('.desktop-reader-stage');
        if (!PageFlip || !content || !outgoingDeck || !incomingDeck || !host || !stage || !content.contains(incomingDeck)) return false;

        const bounds = pageBounds(incomingDeck);
        const stageBounds = stage.getBoundingClientRect();
        if (!bounds || bounds.pageWidth < 80 || bounds.bottom - bounds.top < 80) return false;
        if (activeSession) activeSession.finish();

        const spreadSize = incomingDeck.dataset.readerSpread === 'double' ? 2 : 1;
        const direction = Number(options.direction) < 0 ? 'previous' : 'next';
        const outgoing = cloneSpread(outgoingDeck, spreadSize);
        const incoming = cloneSpread(incomingDeck, spreadSize);
        let sheets;
        if (direction === 'next') {
            // Keep the live spread away from StPageFlip's leading boundary so its forward sheet remains drawable.
            const turningSpread = incoming.map((page) => page.cloneNode(true));
            if (spreadSize === 2) turningSpread[0] = outgoing[spreadSize - 1].cloneNode(true);
            turningSpread.forEach((page) => page.classList.add('desktop-reader-page-flip-sheet'));
            sheets = cloneSpread(outgoingDeck, spreadSize).concat(outgoing, turningSpread);
        } else {
            sheets = incoming.concat(outgoing);
        }
        const root = document.createElement('div');
        root.className = 'desktop-reader-page-flip-root';
        root.append(...sheets);

        const contentStyle = global.getComputedStyle(content);
        host.style.color = contentStyle.color;
        host.style.fontFamily = contentStyle.fontFamily;
        host.style.fontSize = contentStyle.fontSize;
        host.style.fontWeight = contentStyle.fontWeight;
        host.style.lineHeight = contentStyle.lineHeight;
        host.replaceChildren(root);
        host.hidden = false;
        host.dataset.readerPageFlipState = 'active';
        host.dataset.readerPageFlipDirection = direction;
        host.dataset.readerPageFlipRuns = String((Number(host.dataset.readerPageFlipRuns) || 0) + 1);
        host.style.left = `${Math.round(bounds.left - stageBounds.left)}px`;
        host.style.top = `${Math.round(bounds.top - stageBounds.top)}px`;
        host.style.width = `${Math.round(bounds.right - bounds.left)}px`;
        host.style.height = `${Math.round(bounds.bottom - bounds.top)}px`;

        let pageFlip;
        let timer;
        let watchdog;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            global.clearTimeout(timer);
            global.clearTimeout(watchdog);
            content.classList.remove('is-reader-page-flip-active');
            host.dataset.readerPageFlipState = 'idle';
            host.hidden = true;
            try { pageFlip?.destroy(); } catch (error) { console.warn('Reader page-flip cleanup failed.', error); }
            host.replaceChildren();
            if (activeSession && activeSession.finish === finish) activeSession = null;
        };
        activeSession = { finish };

        try {
            const durationMs = Math.max(360, Number(options.durationMs) || 620);
            pageFlip = new PageFlip(root, {
                width: Math.max(80, Math.round(bounds.pageWidth)),
                height: Math.max(80, Math.round(bounds.bottom - bounds.top)),
                size: 'fixed',
                startPage: spreadSize,
                flippingTime: durationMs,
                drawShadow: true,
                maxShadowOpacity: 0.32,
                showCover: false,
                usePortrait: true,
                autoSize: false,
                mobileScrollSupport: false,
                useMouseEvents: false,
                showPageCorners: false,
                disableFlipByClick: false
            });
            pageFlip.loadFromHTML(sheets);
            let started = false;
            let startedAt = 0;
            pageFlip.on('changeState', (event) => {
                if (event.data === 'flipping') {
                    started = true;
                    startedAt = global.performance.now();
                    host.dataset.readerPageFlipState = 'flipping';
                    host.dataset.readerPageFlipStarts = String((Number(host.dataset.readerPageFlipStarts) || 0) + 1);
                }
                if (started && event.data === 'read') {
                    host.dataset.readerPageFlipDuration = String(Math.round(global.performance.now() - startedAt));
                    host.dataset.readerPageFlipCompletions = String((Number(host.dataset.readerPageFlipCompletions) || 0) + 1);
                    finish();
                }
            });
            const begin = () => {
                if (finished) return;
                try {
                    content.classList.add('is-reader-page-flip-active');
                    if (direction === 'next') pageFlip.flipNext('bottom');
                    else pageFlip.flipPrev('bottom');
                    if (!started) finish();
                    else timer = global.setTimeout(finish, durationMs + 500);
                } catch (error) {
                    console.warn('Reader page-flip animation failed.', error);
                    finish();
                }
            };
            if (typeof global.__readerPageFlipTestHook === 'function') {
                global.__readerPageFlipTestHook({ pageFlip, direction });
                begin();
            } else {
                global.requestAnimationFrame(begin);
            }
            watchdog = global.setTimeout(finish, durationMs + 5000);
            return true;
        } catch (error) {
            console.warn('Reader page-flip adapter fell back to the built-in transition.', error);
            finish();
            return false;
        }
    }

    global.startReaderPageFlip = startReaderPageFlip;
    global.stopReaderPageFlip = function stopReaderPageFlip() {
        if (activeSession) activeSession.finish();
    };
})(window);
