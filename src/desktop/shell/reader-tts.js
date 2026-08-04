/* global readerWorkspaceChapterIndex */

(function () {
    const TTS_VOICE_KEY = 'draftharbor:ttsVoice';
    const TTS_SPEED_KEY = 'draftharbor:ttsSpeed';
    const TTS_VOLUME_KEY = 'draftharbor:ttsVolume';
    const TTS_PAUSE_KEY = 'draftharbor:ttsParagraphPause';
    const TTS_AUTO_ADVANCE_KEY = 'draftharbor:ttsAutoAdvance';
    const TTS_TIMER_KEY = 'draftharbor:ttsTimer';
    let bound = false;
    let utterance = null;
    let generation = 0;
    let paragraphTimer = null;
    let timerInterval = null;
    let timerRemainingSeconds = 0;
    let positionSaveTimer = null;
    let observer = null;

    function ttsApi() {
        return window.DraftHarborReaderTts;
    }

    function supported() {
        return !!(window.speechSynthesis && typeof window.speechSynthesis.speak === 'function' && typeof window.SpeechSynthesisUtterance === 'function');
    }

    function readStorage(key, fallback = '') {
        try { return window.localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
    }

    function writeStorage(key, value) {
        try { window.localStorage.setItem(key, String(value)); } catch (_) { /* local preferences are optional */ }
    }

    function ttsSettings() {
        const api = ttsApi();
        return api.normalizeReaderTtsSettings({
            voiceName: readStorage(TTS_VOICE_KEY),
            rate: Number(readStorage(TTS_SPEED_KEY, '1')),
            volume: Number(readStorage(TTS_VOLUME_KEY, '1')),
            paragraphPauseMs: Number(readStorage(TTS_PAUSE_KEY, '350')),
            autoAdvance: readStorage(TTS_AUTO_ADVANCE_KEY, 'true') !== 'false',
            timerMinutes: Number(readStorage(TTS_TIMER_KEY, '0'))
        });
    }

    function ensureState() {
        const api = ttsApi();
        if (!readerState.tts || !readerState.tts.settings) readerState.tts = api.createReaderTtsState({ settings: ttsSettings() });
        else readerState.tts.settings = api.normalizeReaderTtsSettings(readerState.tts.settings);
        return readerState.tts;
    }

    function setState(next) {
        readerState.tts = next;
        renderTtsControls();
        return next;
    }

    function voices() {
        return window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function'
            ? window.speechSynthesis.getVoices() : [];
    }

    function selectedVoice() {
        const name = ensureState().settings.voiceName;
        return voices().find((voice) => voice.name === name)
            || voices().find((voice) => /^zh(-|_)/i.test(voice.lang || ''))
            || voices()[0]
            || null;
    }

    function setStatus(message, tone = '') {
        const status = document.querySelector('[data-reader-tts-status]');
        if (status) {
            status.textContent = message;
            status.dataset.tone = tone;
        }
    }

    function renderTtsVoices() {
        const select = document.querySelector('[data-reader-tts-voice]');
        if (!select) return;
        const state = ensureState();
        const available = voices();
        select.replaceChildren();
        const system = document.createElement('option');
        system.value = '';
        system.textContent = available.length ? '自动选择本机声音' : '等待本机声音…';
        select.appendChild(system);
        available.forEach((voice) => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = `${voice.name} (${voice.lang || 'unknown'})`;
            option.selected = voice.name === state.settings.voiceName;
            select.appendChild(option);
        });
        if (state.settings.voiceName && !available.some((voice) => voice.name === state.settings.voiceName)) {
            const unavailable = document.createElement('option');
            unavailable.value = state.settings.voiceName;
            unavailable.textContent = `${state.settings.voiceName}（当前不可用）`;
            unavailable.disabled = true;
            unavailable.selected = true;
            select.appendChild(unavailable);
        }
        if (!state.settings.voiceName) select.value = '';
        const supportStatus = document.querySelector('[data-reader-tts-support-status]');
        if (supportStatus) supportStatus.textContent = supported() ? `本机语音可用${available.length ? ` · ${available.length} 个声音` : ''}` : '当前环境不支持本机语音';
    }

    function renderTtsControls() {
        const state = ensureState();
        const toggle = document.querySelector('[data-reader-tts-toggle]');
        const stop = document.querySelector('[data-reader-tts-stop]');
        const rate = document.querySelector('[data-reader-tts-rate]');
        const rateValue = document.querySelector('[data-reader-tts-rate-value]');
        const volume = document.querySelector('[data-reader-tts-volume]');
        const volumeValue = document.querySelector('[data-reader-tts-volume-value]');
        const pause = document.querySelector('[data-reader-tts-paragraph-pause]');
        const pauseValue = document.querySelector('[data-reader-tts-paragraph-pause-value]');
        const autoAdvance = document.querySelector('[data-reader-tts-auto-advance]');
        const timer = document.querySelector('[data-reader-tts-timer]');
        const timerStatus = document.querySelector('[data-reader-tts-timer-status]');
        const isReading = state.status === 'speaking' || state.status === 'paused';
        if (toggle) {
            toggle.disabled = !supported() || !readerState.currentChapter;
            toggle.textContent = state.status === 'speaking' ? '暂停朗读' : state.status === 'paused' ? '继续朗读' : '朗读当前位置';
            toggle.setAttribute('aria-pressed', state.status === 'speaking' ? 'true' : 'false');
        }
        if (stop) {
            stop.hidden = !isReading;
            stop.disabled = !isReading;
        }
        if (rate) rate.value = String(state.settings.rate);
        if (rateValue) rateValue.textContent = `${state.settings.rate.toFixed(1)}×`;
        if (volume) volume.value = String(state.settings.volume);
        if (volumeValue) volumeValue.textContent = `${Math.round(state.settings.volume * 100)}%`;
        if (pause) pause.value = String(state.settings.paragraphPauseMs);
        if (pauseValue) pauseValue.textContent = `${state.settings.paragraphPauseMs} ms`;
        if (autoAdvance) autoAdvance.checked = state.settings.autoAdvance;
        if (timer) timer.value = String(state.settings.timerMinutes);
        if (timerStatus) timerStatus.textContent = timerRemainingSeconds > 0
            ? `本次朗读剩余 ${Math.ceil(timerRemainingSeconds / 60)} 分钟`
            : state.settings.timerMinutes ? `定时 ${state.settings.timerMinutes} 分钟` : '不自动停止';
        if (!supported()) setStatus('当前环境不支持本机语音。', 'error');
        else if (state.status === 'error') setStatus(`朗读失败：${state.errorCode || '未知错误'}`, 'error');
        else if (state.status === 'unsupported') setStatus('当前环境不支持本机语音。', 'error');
        else if (state.status === 'speaking') setStatus('正在朗读当前位置…');
        else if (state.status === 'paused') setStatus('朗读已暂停。');
        else if (state.status === 'completed') setStatus('已读完当前阅读范围。');
        else if (state.status === 'stopped') setStatus('朗读已停止。');
        else if (!readerState.currentChapter) setStatus('打开一本书后可以开始朗读。');
        else setStatus('本机语音就绪。');
    }

    function clearParagraphTimer() {
        if (paragraphTimer) window.clearTimeout(paragraphTimer);
        paragraphTimer = null;
    }

    function clearTimerInterval() {
        if (timerInterval) window.clearInterval(timerInterval);
        timerInterval = null;
    }

    function clearPositionTimer() {
        if (positionSaveTimer) window.clearTimeout(positionSaveTimer);
        positionSaveTimer = null;
    }

    function saveTtsPosition() {
        clearPositionTimer();
        if (readerState.apiMode && typeof queueReaderDocumentStateWrite === 'function' && typeof captureReaderPositionLocator === 'function') {
            const locator = captureReaderPositionLocator();
            if (locator) queueReaderDocumentStateWrite({ positionLocator: locator }).catch(() => {});
        }
    }

    function scheduleTtsPositionSave() {
        clearPositionTimer();
        positionSaveTimer = window.setTimeout(saveTtsPosition, 500);
    }

    function syncTtsPosition(item) {
        if (!item || !readerState.currentChapter) return;
        const locator = typeof createReaderLocatorAt === 'function' ? createReaderLocatorAt(item.blockId, item.startOffset) : null;
        if (!locator) return;
        readerState.anchorLocator = locator;
        readerState.tts.chapterId = item.chapterId;
        readerState.tts.blockId = item.blockId;
        readerState.tts.offset = item.startOffset;
        if (typeof renderReaderReading === 'function') renderReaderReading({ locator });
        if (typeof updateReaderWorkspaceProgress === 'function') updateReaderWorkspaceProgress();
        scheduleTtsPositionSave();
    }

    function cancelSpeech() {
        generation += 1;
        clearParagraphTimer();
        if (window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') window.speechSynthesis.cancel();
        utterance = null;
    }

    function finish(status = 'completed', message) {
        cancelSpeech();
        clearTimerInterval();
        saveTtsPosition();
        const api = ttsApi();
        setState(api.transitionReaderTts(ensureState(), status === 'completed' ? 'complete' : 'stop'));
        if (message) setStatus(message);
    }

    function beginTimer() {
        clearTimerInterval();
        const minutes = ensureState().settings.timerMinutes;
        timerRemainingSeconds = minutes * 60;
        if (!minutes) return;
        timerInterval = window.setInterval(() => {
            if (ensureState().status !== 'speaking') return;
            timerRemainingSeconds = Math.max(0, timerRemainingSeconds - 1);
            renderTtsControls();
            if (!timerRemainingSeconds) finish('stopped', '定时结束，朗读已停止。');
        }, 1000);
    }

    async function nextChapter() {
        const currentIndex = typeof readerWorkspaceChapterIndex === 'function' ? readerWorkspaceChapterIndex() : -1;
        const next = readerState.contents && readerState.contents[currentIndex + 1];
        if (!next || typeof loadReaderWorkspaceChapter !== 'function') return false;
        readerState.tts.internalNavigation = true;
        try {
            await loadReaderWorkspaceChapter(next.chapterId);
            return true;
        } finally {
            readerState.tts.internalNavigation = false;
        }
    }

    function queueForCurrentChapter() {
        const api = ttsApi();
        const locator = typeof captureReaderPositionLocator === 'function' ? captureReaderPositionLocator() : null;
        return api.createReaderTtsQueue(readerState.currentChapter, locator, ensureState().settings);
    }

    function speakQueueItem(queue, index, token) {
        if (token !== generation || ensureState().status !== 'speaking') return;
        const item = queue[index];
        if (!item) {
            if (ensureState().settings.autoAdvance) {
                nextChapter().then((advanced) => {
                    if (!advanced) finish('completed');
                    else {
                        const nextQueue = queueForCurrentChapter();
                        readerState.tts.queue = nextQueue;
                        readerState.tts.queueIndex = 0;
                        speakQueueItem(nextQueue, 0, token);
                    }
                }).catch((error) => setState(ttsApi().transitionReaderTts(ensureState(), 'error', { errorCode: error.message || 'chapter-load-failed' })));
            } else finish('completed');
            return;
        }
        readerState.tts.queue = queue;
        readerState.tts.queueIndex = index;
        syncTtsPosition(item);
        const settings = ensureState().settings;
        utterance = new window.SpeechSynthesisUtterance(item.text);
        utterance.rate = settings.rate;
        utterance.volume = settings.volume;
        const voice = selectedVoice();
        if (voice) utterance.voice = voice;
        utterance.onstart = () => {
            if (token === generation) renderTtsControls();
        };
        utterance.onend = () => {
            if (token !== generation || ensureState().status !== 'speaking') return;
            const next = queue[index + 1];
            const delay = next && next.blockId !== item.blockId ? settings.paragraphPauseMs : 0;
            if (delay) paragraphTimer = window.setTimeout(() => speakQueueItem(queue, index + 1, token), delay);
            else speakQueueItem(queue, index + 1, token);
        };
        utterance.onerror = (event) => {
            if (token !== generation || event.error === 'canceled' || event.error === 'interrupted') return;
            clearTimerInterval();
            setState(ttsApi().transitionReaderTts(ensureState(), 'error', { errorCode: event.error || 'speech-error' }));
        };
        window.speechSynthesis.speak(utterance);
    }

    function start() {
        if (!supported()) {
            setState(ttsApi().transitionReaderTts(ensureState(), 'unsupported'));
            return;
        }
        if (!readerState.apiMode || !readerState.currentChapter) {
            setStatus('请先打开一本书。', 'error');
            return;
        }
        cancelSpeech();
        const queue = queueForCurrentChapter();
        if (!queue.length) {
            setStatus('当前章节没有可朗读文本。', 'error');
            return;
        }
        const token = generation;
        readerState.tts.queue = queue;
        readerState.tts.queueIndex = 0;
        timerRemainingSeconds = 0;
        beginTimer();
        setState(ttsApi().transitionReaderTts(ensureState(), 'start'));
        speakQueueItem(queue, 0, token);
    }

    function pause() {
        if (ensureState().status !== 'speaking') return;
        window.speechSynthesis.pause();
        setState(ttsApi().transitionReaderTts(ensureState(), 'pause'));
    }

    function resume() {
        if (ensureState().status !== 'paused') return;
        window.speechSynthesis.resume();
        setState(ttsApi().transitionReaderTts(ensureState(), 'resume'));
    }

    function stop(message) {
        if (!['speaking', 'paused'].includes(ensureState().status)) return;
        finish('stopped', message);
    }

    function toggle() {
        if (ensureState().status === 'speaking') pause();
        else if (ensureState().status === 'paused') resume();
        else start();
    }

    function updateSetting(key, value) {
        const settings = ttsApi().normalizeReaderTtsSettings({ ...ensureState().settings, [key]: value });
        readerState.tts.settings = settings;
        const keys = { voiceName: TTS_VOICE_KEY, rate: TTS_SPEED_KEY, volume: TTS_VOLUME_KEY, paragraphPauseMs: TTS_PAUSE_KEY, autoAdvance: TTS_AUTO_ADVANCE_KEY, timerMinutes: TTS_TIMER_KEY };
        writeStorage(keys[key], settings[key]);
        if (utterance && ensureState().status === 'speaking' && ['rate', 'volume', 'voiceName'].includes(key)) {
            stop('设置已更新，请从当前位置继续朗读。');
        }
        renderTtsControls();
    }

    function pauseForNavigation() {
        if (readerState.tts?.internalNavigation) return;
        stop('阅读位置已改变，朗读已停止。');
    }

    function pauseForConflict(message = '朗读已暂停。') {
        if (ensureState().status !== 'speaking') return;
        window.speechSynthesis.pause();
        setState(ttsApi().transitionReaderTts(ensureState(), 'pause'));
        setStatus(message);
    }

    function observeConflicts() {
        const shell = document.querySelector('[data-reader-shell]');
        if (!shell || observer) return;
        observer = new MutationObserver(() => {
            if (readerState.tts?.status !== 'speaking') return;
            const panelOpen = !!readerState.drawer || !!shell.querySelector('dialog[open]');
            const selectionOpen = !!readerState.transferSelection || !!shell.querySelector('[data-reader-selection-toolbar]:not([hidden])');
            if (panelOpen || selectionOpen) pauseForConflict('打开面板或选择文本时，朗读已暂停。');
        });
        observer.observe(shell, { attributes: true, subtree: true, attributeFilter: ['open', 'hidden', 'aria-hidden', 'data-reader-drawer'] });
    }

    function initializeReaderTts() {
        if (!bound) {
            bound = true;
            ensureState().settings = ttsSettings();
            document.querySelector('[data-reader-tts-toggle]')?.addEventListener('click', toggle);
            document.querySelector('[data-reader-tts-stop]')?.addEventListener('click', () => stop());
            document.querySelector('[data-reader-tts-refresh-voices]')?.addEventListener('click', renderTtsVoices);
            document.querySelector('[data-reader-tts-voice]')?.addEventListener('change', (event) => updateSetting('voiceName', event.currentTarget.value));
            document.querySelector('[data-reader-tts-rate]')?.addEventListener('input', (event) => updateSetting('rate', Number(event.currentTarget.value)));
            document.querySelector('[data-reader-tts-volume]')?.addEventListener('input', (event) => updateSetting('volume', Number(event.currentTarget.value)));
            document.querySelector('[data-reader-tts-paragraph-pause]')?.addEventListener('input', (event) => updateSetting('paragraphPauseMs', Number(event.currentTarget.value)));
            document.querySelector('[data-reader-tts-auto-advance]')?.addEventListener('change', (event) => updateSetting('autoAdvance', event.currentTarget.checked));
            document.querySelector('[data-reader-tts-timer]')?.addEventListener('change', (event) => updateSetting('timerMinutes', Number(event.currentTarget.value)));
            window.speechSynthesis?.addEventListener?.('voiceschanged', renderTtsVoices);
            document.addEventListener('visibilitychange', () => { if (document.hidden) pauseForConflict('窗口失焦，朗读已暂停。'); });
            window.addEventListener('blur', () => pauseForConflict('窗口失焦，朗读已暂停。'));
            document.addEventListener('selectionchange', () => { if (readerState.transferSelection) pauseForConflict('选择文本时，朗读已暂停。'); });
            observeConflicts();
        }
        renderTtsVoices();
        renderTtsControls();
    }

    window.initializeReaderTts = initializeReaderTts;
    window.readerTtsPauseForNavigation = pauseForNavigation;
    window.readerTtsStop = stop;
    window.readerTtsRefreshVoices = renderTtsVoices;
})();
