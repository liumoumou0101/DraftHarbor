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
        const sheets = direction === 'next' ? outgoing.concat(incoming) : incoming.concat(outgoing);
        const root = document.createElement('div');
        root.className = 'desktop-reader-page-flip-root';
        root.append(...sheets);

        host.replaceChildren(root);
        host.hidden = false;
        host.dataset.readerPageFlipState = 'active';
        host.dataset.readerPageFlipRuns = String((Number(host.dataset.readerPageFlipRuns) || 0) + 1);
        host.style.left = `${Math.round(bounds.left - stageBounds.left)}px`;
        host.style.top = `${Math.round(bounds.top - stageBounds.top)}px`;
        host.style.width = `${Math.round(bounds.right - bounds.left)}px`;
        host.style.height = `${Math.round(bounds.bottom - bounds.top)}px`;
        content.classList.add('is-reader-page-flip-active');

        let pageFlip;
        let timer;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            global.clearTimeout(timer);
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
                startPage: direction === 'next' ? 0 : spreadSize,
                flippingTime: durationMs,
                drawShadow: true,
                maxShadowOpacity: 0.32,
                showCover: false,
                usePortrait: true,
                autoSize: false,
                mobileScrollSupport: false,
                useMouseEvents: false,
                showPageCorners: false,
                disableFlipByClick: true
            });
            pageFlip.loadFromHTML(sheets);
            let started = false;
            pageFlip.on('changeState', (event) => {
                if (event.data === 'flipping') started = true;
                if (started && event.data === 'read') finish();
            });
            timer = global.setTimeout(finish, durationMs + 500);
            global.requestAnimationFrame(() => {
                if (finished) return;
                try {
                    if (direction === 'next') pageFlip.flipNext('bottom');
                    else pageFlip.flipPrev('bottom');
                } catch (error) {
                    console.warn('Reader page-flip animation failed.', error);
                    finish();
                }
            });
            return true;
        } catch (error) {
            console.warn('Reader page-flip adapter fell back to the built-in transition.', error);
            finish();
            return false;
        }
    }

    global.startReaderPageFlip = startReaderPageFlip;
})(window);
