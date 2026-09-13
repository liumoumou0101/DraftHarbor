    function nativePendingInlineValue(generation) {
        if (!generation || !generation.pendingSceneId) return '';
        const base = generation.inlineBaseText || '';
        const inserted = formatInlineGeneratedText(generation.text || '');
        return `${base.slice(0, generation.insertionStart)}${inserted}${base.slice(generation.insertionEnd)}`;
    }

    function isNativePendingInlineValueStable(elements = nativeEditorElements()) {
        const generation = nativeEditorState.generation;
        const scene = currentNativeScene();
        if (!elements.editor || !scene || !generation.pendingSceneId || generation.pendingSceneId !== scene.id) return false;
        return elements.editor.value === nativePendingInlineValue(generation);
    }

    function hideNativeGenerationLayer(layer, content) {
        if (layer) layer.hidden = true;
        if (content) {
            content.replaceChildren();
            content.style.transform = '';
        }
    }

    function applyNativeGenerationLayerViewport(layer, content, editor, body, computed) {
        const bodyRect = body.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        if (bodyRect.width < 1 || bodyRect.height < 1 || editorRect.width < 1 || editorRect.height < 1) return false;
        layer.style.left = `${editorRect.left - bodyRect.left}px`;
        layer.style.top = `${editorRect.top - bodyRect.top}px`;
        layer.style.width = `${editorRect.width}px`;
        layer.style.height = `${editorRect.height}px`;
        layer.style.padding = '0';
        layer.style.boxSizing = computed.boxSizing;
        content.style.width = `${editor.clientWidth}px`;
        content.style.minHeight = `${Math.max(editor.scrollHeight, editor.clientHeight)}px`;
        content.style.padding = '0';
        content.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
        return true;
    }

    function applyNativeGenerationMeasureStyle(measure, computed) {
        measure.style.padding = computed.padding;
        measure.style.boxSizing = computed.boxSizing;
        measure.style.font = computed.font;
        measure.style.lineHeight = computed.lineHeight;
        measure.style.letterSpacing = computed.letterSpacing;
        measure.style.wordSpacing = computed.wordSpacing;
        measure.style.textAlign = computed.textAlign;
        measure.style.textIndent = computed.textIndent;
        measure.style.whiteSpace = computed.whiteSpace;
        measure.style.wordBreak = computed.wordBreak;
        measure.style.overflowWrap = computed.overflowWrap;
        measure.style.tabSize = computed.tabSize;
        if ('lineBreak' in measure.style) measure.style.lineBreak = computed.lineBreak;
    }

    function ensureNativeGenerationLayerParts(content) {
        let measure = content.querySelector('[data-native-generation-measure]');
        let dimBefore = content.querySelector('[data-native-generation-dim-before]');
        let band = content.querySelector('[data-native-generation-band]');
        let dimAfter = content.querySelector('[data-native-generation-dim-after]');
        let split = content.querySelector('[data-native-generation-split]');
        let before = measure && measure.querySelector('[data-native-generation-before]');
        let pending = measure && measure.querySelector('[data-native-generation-mark]');
        let after = measure && measure.querySelector('[data-native-generation-after]');
        if (measure && dimBefore && band && dimAfter && split && before && pending && after) {
            return { measure, dimBefore, band, dimAfter, split, before, pending, after };
        }
        content.replaceChildren();
        measure = document.createElement('div');
        measure.className = 'desktop-native-editor-generation-measure';
        measure.setAttribute('data-native-generation-measure', '');
        before = document.createElement('span');
        before.setAttribute('data-native-generation-before', '');
        pending = document.createElement('span');
        pending.className = 'desktop-native-editor-generation-mark';
        pending.setAttribute('data-native-generation-mark', '');
        after = document.createElement('span');
        after.setAttribute('data-native-generation-after', '');
        measure.append(before, pending, after);
        dimBefore = document.createElement('div');
        dimBefore.className = 'desktop-native-editor-generation-dim';
        dimBefore.setAttribute('data-native-generation-dim-before', '');
        band = document.createElement('div');
        band.className = 'desktop-native-editor-generation-band';
        band.setAttribute('data-native-generation-band', '');
        split = document.createElement('span');
        split.className = 'desktop-native-editor-generation-split';
        split.setAttribute('data-native-generation-split', '');
        split.textContent = '以下为新生成';
        band.append(split);
        dimAfter = document.createElement('div');
        dimAfter.className = 'desktop-native-editor-generation-dim';
        dimAfter.setAttribute('data-native-generation-dim-after', '');
        content.append(measure, dimBefore, band, dimAfter);
        return { measure, dimBefore, band, dimAfter, split, before, pending, after };
    }

    function layoutNativeGenerationBand(parts, content) {
        const range = document.createRange();
        range.selectNodeContents(parts.pending);
        const pendingRect = range.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const startY = Math.max(0, Math.round(pendingRect.top - contentRect.top));
        const endY = Math.max(startY, Math.round(pendingRect.bottom - contentRect.top));
        const height = Math.max(1, endY - startY);
        const total = Math.max(endY, parts.measure.offsetHeight);
        parts.dimBefore.style.top = '0';
        parts.dimBefore.style.height = `${startY}px`;
        parts.band.style.top = `${startY}px`;
        parts.band.style.height = `${height}px`;
        parts.dimAfter.style.top = `${endY}px`;
        parts.dimAfter.style.height = `${Math.max(0, total - endY)}px`;
    }

    function syncNativeGenerationLayerScroll() {
        const elements = nativeEditorElements();
        const layer = elements.generationLayer;
        const content = elements.generationLayerContent;
        const editor = elements.editor;
        if (!layer || !content || !editor || layer.hidden) return;
        content.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
    }

    function syncNativeGenerationLayer() {
        const elements = nativeEditorElements();
        const layer = elements.generationLayer;
        const content = elements.generationLayerContent;
        const editor = elements.editor;
        const generation = nativeEditorState.generation;
        const scene = currentNativeScene();
        const isPreviewTask = generation.task === 'rewrite' || generation.task === 'regenerate-selection';
        const hasPendingInline = !!generation.text
            && !isPreviewTask
            && !!scene
            && generation.pendingSceneId === scene.id
            && !!editor;
        if (!layer || !content || !editor || !hasPendingInline) {
            hideNativeGenerationLayer(layer, content);
            return false;
        }
        if (!isNativePendingInlineValueStable(elements)) {
            generation.pendingEditorChanged = true;
            hideNativeGenerationLayer(layer, content);
            if (elements.generationOutputStatus) {
                elements.generationOutputStatus.textContent = '正文已修改，无法直接确认；请重新生成或撤回。';
            }
            return false;
        }
        generation.pendingEditorChanged = false;
        const body = elements.editorBody;
        if (!body) return false;
        const computed = window.getComputedStyle(editor);
        if (!applyNativeGenerationLayerViewport(layer, content, editor, body, computed)) {
            layer.hidden = true;
            return false;
        }
        const value = editor.value || '';
        const inserted = formatInlineGeneratedText(generation.text || '');
        const start = Math.max(0, Math.min(value.length, generation.insertionStart));
        const end = Math.max(start, Math.min(value.length, start + inserted.length));
        const parts = ensureNativeGenerationLayerParts(content);
        applyNativeGenerationMeasureStyle(parts.measure, computed);
        parts.before.textContent = value.slice(0, start);
        parts.pending.textContent = value.slice(start, end);
        parts.after.textContent = value.slice(end);
        layer.hidden = false;
        layoutNativeGenerationBand(parts, content);
        return true;
    }

    function queueNativeGenerationLayer() {
        const layer = nativeEditorElements().generationLayer;
        if (!layer || layer.__nativeGenerationLayerFrame) return;
        const schedule = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : (callback) => window.setTimeout(callback, 0);
        layer.__nativeGenerationLayerFrame = schedule(() => {
            layer.__nativeGenerationLayerFrame = 0;
            syncNativeGenerationLayer();
        });
    }

    function bindNativeGenerationLayer() {
        const elements = nativeEditorElements();
        const editor = elements.editor;
        if (!editor || editor.dataset.nativeGenerationLayerBound === 'true') return;
        editor.dataset.nativeGenerationLayerBound = 'true';
        editor.addEventListener('scroll', syncNativeGenerationLayerScroll, { passive: true });
        window.addEventListener('resize', queueNativeGenerationLayer);
    }

    function insertNativeHistoryRecord(record) {
        const generation = nativeEditorState.generation;
        if (!record || !record.resultText) return;
        if (generation.text && generation.inlineBaseText) restorePendingInlineGeneration();
        generation.beat = record.beat || '';
        generation.text = record.resultText || '';
        generation.reasoning = record.reasoning || '';
        generation.prompt = { messages: record.messages || [], asString: () => record.promptText || '' };
        generation.record = record;
        if (!prepareInlineGeneration('fiction-prose', null)) return;
        syncInlineGenerationToEditor();
        flushNativeEditorFields();
        markNativeDirty('历史生成已写入正文，未保存');
        renderNativeGeneration();
    }

    function deleteNativeHistoryRecord(record) {
        const snapshot = nativeEditorState.snapshot;
        if (!snapshot || !Array.isArray(snapshot.promptHistory) || !record) return;
        snapshot.promptHistory = snapshot.promptHistory.filter((item) => item.id !== record.id);
        if (nativeEditorState.generation.record && nativeEditorState.generation.record.id === record.id) {
            nativeEditorState.generation.record = null;
        }
        markNativeDirty('历史记录已删除，未保存');
        renderNativeGeneration();
    }

    async function copyNativeHistoryRecord(record) {
        if (!record || !record.resultText) return;
        window.__draftHarborAuditClipboard = record.resultText;
        try {
            if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(record.resultText);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = record.resultText;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            setNativeSaveStatus('已复制到剪贴板', 'ok');
        } catch (error) {
            setNativeSaveStatus('复制失败', 'error');
        }
    }

    async function retryNativeHistoryRecord(record) {
        if (!record || !record.beat) return;
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        if (!scene) {
            setNativeSaveStatus('请先选择一个场景', 'error');
            return;
        }
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(() => null);
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        const generation = nativeEditorState.generation;
        if (generation.inProgress) return;
        if (generation.text && generation.inlineBaseText) restorePendingInlineGeneration();
        generation.text = '';
        resetNativeGenerationStreamFlags(generation);
        generation.record = null;
        generation.prompt = null;
        generation.beat = record.beat || '';
        if (elements.beatInput) elements.beatInput.value = generation.beat;
        if (elements.generationResult) elements.generationResult.textContent = '';
        if (elements.generationOutput) elements.generationOutput.hidden = false;
        setNativeSaveStatus('正在重试...', 'info');
        nativeEditorState.assistantPanel = 'generate';
        renderNativeEditor();
        await startNativeGeneration();
    }

    function buildNativePrompt() {
        const elements = nativeEditorElements();
        if (elements.beatInput) nativeEditorState.generation.beat = elements.beatInput.value;
        const scene = currentNativeScene();
        const snapshot = nativeEditorState.snapshot;
        if (!scene || !snapshot || !window.DraftHarborPromptBuilder) return null;
        flushNativeEditorFields();
        const chapter = currentNativeChapter(scene);
        const template = selectedPromptTemplate();
        const context = window.DraftHarborContextResolver && typeof window.DraftHarborContextResolver.resolveContext === 'function'
            ? window.DraftHarborContextResolver.resolveContext({
                project: {
                    ...snapshot,
                    currentSceneId: scene.id
                },
                beat: nativeEditorState.generation.beat,
                selection: {
                    currentSceneId: scene.id,
                    recentSceneLimit: 6,
                    maxChars: 6000
                }
            })
            : { compendiumEntries: [], sceneSummaries: [] };
        const compendiumMap = new Map((context.compendiumEntries || []).map((entry) => [entry.id, entry]));
        (snapshot.compendium || []).forEach((entry) => {
            if (nativeEditorState.context.compendiumIds.includes(entry.id)) compendiumMap.set(entry.id, entry);
            const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [];
            if (tags.some((tag) => nativeEditorState.context.compendiumTags.includes(tag))) compendiumMap.set(entry.id, entry);
        });
        const sceneSummaryMap = new Map((context.sceneSummaries || []).map((item) => [item.title, item]));
        Object.entries(nativeEditorState.context.chapterModes || {}).forEach(([chapterId, mode]) => {
            const chapter = (snapshot.chapters || []).find((item) => item.id === chapterId);
            if (!chapter) return;
            const chapterScenes = (snapshot.scenes || [])
                .filter((item) => item.chapterId === chapterId && item.id !== scene.id)
                .sort((a, b) => (a.order || 0) - (b.order || 0));
            const summary = mode === 'full'
                ? chapterScenes.map((item) => `${item.title || '未命名场景'}\n${nativeSceneContent(item.id)}`).join('\n\n')
                : ((!chapter.summaryStale && chapter.summary) || chapterScenes.map((item) => `${item.title || '未命名场景'}：${(!item.summaryStale && item.summary) || nativeSceneContent(item.id).slice(0, 600)}`).join('\n'));
            if (summary.trim()) {
                sceneSummaryMap.set(chapter.title || chapter.id, {
                    title: chapter.title || '未命名章节',
                    summary
                });
            }
        });
        Object.entries(nativeEditorState.context.sceneModes || {}).forEach(([sceneId, mode]) => {
            const referenced = (snapshot.scenes || []).find((item) => item.id === sceneId);
            if (!referenced || referenced.id === scene.id) return;
            sceneSummaryMap.set(referenced.title || referenced.id, {
                title: referenced.title || '未命名场景',
                summary: mode === 'full' ? nativeSceneContent(referenced.id) : ((!referenced.summaryStale && referenced.summary) || nativeSceneContent(referenced.id).slice(0, 600))
            });
        });
        return window.DraftHarborPromptBuilder.buildFictionPrompt({
            beat: nativeEditorState.generation.beat,
            sceneContext: nativeSceneContent(scene.id),
            options: {
                povCharacter: scene.povCharacter || '',
                pov: '3rd person limited',
                tense: scene.tense || 'past',
                sceneSummaries: Array.from(sceneSummaryMap.values()),
                compendiumEntries: Array.from(compendiumMap.values()),
                systemPrompt: template.systemContent || '',
                prosePrompt: [chapter && chapter.summary && !chapter.summaryStale ? `Chapter context: ${chapter.summary}` : '', template.content || '', context.manualText || '', nativeAvoidanceInstruction()].filter(Boolean).join('\n\n'),
                lengthHint: nativeEditorState.generation.lengthHint || 'natural'
            }
        });
    }

    function showNativePromptPreview() {
        if (nativeEditorState.generation.genTask === 'summary') return;
        const elements = nativeEditorElements();
        const prompt = buildNativePrompt();
        if (!prompt) return;
        nativeEditorState.generation.prompt = prompt;
        if (elements.promptPreview) elements.promptPreview.textContent = prompt.asString ? prompt.asString() : JSON.stringify(prompt.messages || prompt, null, 2);
        if (elements.promptDialog && typeof elements.promptDialog.showModal === 'function') {
            elements.promptDialog.showModal();
        }
    }

    function nativeGenerationConfig(signal) {
        const effectiveProfile = writerEffectiveProfile();
        const selectedModel = writerSelectedModelId(effectiveProfile);
        const extras = {
            signal,
            includeUsage: true,
            sessionId: `writer:${nativeEditorState.snapshot && nativeEditorState.snapshot.project && nativeEditorState.snapshot.project.id || ''}:${currentNativeScene() && currentNativeScene().id || ''}`,
            projectDirectiveStack: nativeEditorState.snapshot && nativeEditorState.snapshot.directiveStack
        };
        if (writerModelOverride.profileId && writerModelOverride.profileId !== 'inherit') {
            extras.profileId = writerModelOverride.profileId;
        }
        if (writerModelOverride.model !== 'inherit' && selectedModel) {
            extras.model = selectedModel;
        }
        const catalog = modelCatalog();
        const modelId = selectedModel || effectiveProfile.model;
        const thinkingControl = catalog.getThinkingControl
            ? catalog.getThinkingControl(effectiveProfile.provider, modelId)
            : (catalog.isThinkingSupported(effectiveProfile.provider, modelId) ? 'toggle' : 'none');
        if (thinkingControl === 'always-on'
            || (writerModelOverride.thinking && (thinkingControl === 'toggle'
                || thinkingControl === 'toggle-adaptive'
                || thinkingControl === 'responses-effort'))) {
            extras.enableThinking = true;
        }
        const config = runtimeProviderConfig(extras);
        const schema = window.DraftHarborSettingsSchema;
        const thinkingRuns = catalog.thinkingWillRun
            ? catalog.thinkingWillRun(config.provider, config.model, config.enableThinking)
            : !!config.enableThinking;
        if (config && thinkingRuns && !config.useProviderDefaults && schema && typeof schema.thinkingOutputQuota === 'function') {
            const quota = schema.thinkingOutputQuota(config.maxTokens, true, config.model);
            if (quota.raised) config.maxTokens = quota.effective;
        }
        return config;
    }

    function prepareInlineGeneration(task, prompt) {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const generation = nativeEditorState.generation;
        if (!elements.editor || !scene) return false;
        const current = elements.editor.value || '';
        let start = current.length;
        let end = current.length;
        if (task === 'rewrite' && prompt && prompt.selection) {
            start = prompt.selection.start;
            end = prompt.selection.end;
        } else {
            const mode = elements.insertMode ? elements.insertMode.value : 'append';
            if (mode === 'replace' && elements.editor.selectionStart !== elements.editor.selectionEnd) {
                start = elements.editor.selectionStart;
                end = elements.editor.selectionEnd;
            } else if (mode === 'cursor') {
                start = elements.editor.selectionStart || 0;
                end = start;
            }
        }
        generation.inlineBaseText = current;
        generation.insertionStart = start;
        generation.insertionEnd = end;
        generation.pendingSceneId = scene.id;
        generation.task = task || 'fiction-prose';
        generation.pendingEditorChanged = false;
        return true;
    }

    function formatInlineGeneratedText(text) {
        const generation = nativeEditorState.generation;
        const base = generation.inlineBaseText || '';
        const before = base.slice(0, generation.insertionStart);
        const after = base.slice(generation.insertionEnd);
        if (generation.task === 'rewrite' || generation.task === 'regenerate-selection') return text;
        if (generation.insertionStart === base.length && generation.insertionEnd === base.length) {
            return base && text ? `\n\n${text}` : text;
        }
        const prefix = before && text && !/\s$/.test(before) ? '\n\n' : '';
        const suffix = after && text && !/^\s/.test(after) ? '\n\n' : '';
        return `${prefix}${text}${suffix}`;
    }

    function syncInlineGenerationToEditor(options = {}) {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const generation = nativeEditorState.generation;
        if (!elements.editor || !scene || generation.pendingSceneId !== scene.id) return;
        const inserted = formatInlineGeneratedText(generation.text || '');
        const nextValue = nativePendingInlineValue(generation);
        elements.editor.value = nextValue;
        generation.pendingEditorChanged = false;
        const cursor = generation.insertionStart + inserted.length;
        if (generation.task === 'rewrite' || generation.task === 'regenerate-selection') {
            elements.editor.selectionStart = cursor;
            elements.editor.selectionEnd = cursor;
        } else {
            // The generated continuation is already rendered in the正文. Keep the
            // caret at its end instead of selecting the whole inserted paragraph;
            // the selection highlight is unreadable on the paper background and
            // disappears as soon as the user clicks elsewhere.
            elements.editor.selectionStart = cursor;
            elements.editor.selectionEnd = cursor;
        }
        if (!options.preserveFocus) elements.editor.focus();
        updateNativeStats();
    }

    function restorePendingInlineGeneration() {
        const elements = nativeEditorElements();
        const generation = nativeEditorState.generation;
        if (!elements.editor || !generation.inlineBaseText || generation.pendingSceneId !== nativeEditorState.activeSceneId) return;
        elements.editor.value = generation.inlineBaseText;
        flushNativeEditorFields();
    }

    function insertNativeSpecialChar(char) {
        const elements = nativeEditorElements();
        if (!elements.editor || elements.editor.disabled) return;
        const value = elements.editor.value || '';
        const start = elements.editor.selectionStart || 0;
        const end = elements.editor.selectionEnd || start;
        elements.editor.value = `${value.slice(0, start)}${char}${value.slice(end)}`;
        elements.editor.focus();
        elements.editor.selectionStart = start + char.length;
        elements.editor.selectionEnd = start + char.length;
        flushNativeEditorFields();
        markNativeDirty('已插入符号，未保存');
        updateNativeStats();
    }

    function stopNativeReading() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        nativeEditorState.tts.reading = false;
        const elements = nativeEditorElements();
        if (elements.readAloud) elements.readAloud.hidden = false;
        if (elements.stopReading) elements.stopReading.hidden = true;
    }

    function readNativeSceneAloud() {
        const elements = nativeEditorElements();
        if (!elements.editor || !window.speechSynthesis) {
            setNativeSaveStatus('当前环境不支持朗读', 'error');
            return;
        }
        const start = elements.editor.selectionStart || 0;
        const end = elements.editor.selectionEnd || 0;
        const text = (start !== end ? elements.editor.value.slice(start, end) : elements.editor.value).trim();
        if (!text) {
            setNativeSaveStatus('没有可朗读的文本', 'error');
            return;
        }
        stopNativeReading();
        const utterance = new SpeechSynthesisUtterance(text);
        const savedRate = Number(window.localStorage.getItem('draftharbor:ttsSpeed') || '1');
        utterance.rate = Number.isFinite(savedRate) ? Math.min(2, Math.max(0.5, savedRate)) : 1;
        const savedVoice = window.localStorage.getItem('draftharbor:ttsVoice') || '';
        const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
        const voice = voices.find((item) => item.name === savedVoice) || voices.find((item) => /zh|Chinese|Mandarin/i.test(`${item.lang} ${item.name}`));
        if (voice) utterance.voice = voice;
        utterance.onend = stopNativeReading;
        utterance.onerror = stopNativeReading;
        nativeEditorState.tts.reading = true;
        if (elements.readAloud) elements.readAloud.hidden = true;
        if (elements.stopReading) elements.stopReading.hidden = false;
        window.speechSynthesis.speak(utterance);
    }

    function applyNativeAutoReplace() {
        const elements = nativeEditorElements();
        if (!elements.editor || elements.editor.disabled) return;
        const cursor = elements.editor.selectionStart || 0;
        const value = elements.editor.value || '';
        if (!value.includes('--')) return;
        const beforeCursor = value.slice(0, cursor);
        const nextValue = value.replace(/--/g, '—');
        const nextCursor = beforeCursor.replace(/--/g, '—').length;
        elements.editor.value = nextValue;
        elements.editor.selectionStart = nextCursor;
        elements.editor.selectionEnd = nextCursor;
    }

    async function startNativeGeneration() {
        const elements = nativeEditorElements();
        if (elements.beatInput) nativeEditorState.generation.beat = elements.beatInput.value;
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(() => null);
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        const scene = currentNativeScene();
        const snapshot = nativeEditorState.snapshot;
        if (!scene || !snapshot) {
            setNativeSaveStatus('请先选择一个场景', 'error');
            return { ok: false, reason: 'no-scene' };
        }
        if (nativeEditorState.generation.inProgress) return { ok: false, reason: 'in-progress' };
        const prompt = buildNativePrompt();
        if (nativeEditorState.generation.genTask === 'beat' && !nativeEditorState.generation.beat.trim()) {
            setNativeSaveStatus('请输入 beat', 'error');
            return { ok: false, reason: 'empty-beat' };
        }
        if (!prompt) {
            setNativeSaveStatus('Prompt 构建失败', 'error');
            return { ok: false, reason: 'no-prompt' };
        }

        const generation = nativeEditorState.generation;
        if (generation.text && generation.inlineBaseText) restorePendingInlineGeneration();
        generation.text = '';
        resetNativeGenerationStreamFlags(generation);
        generation.prompt = prompt;
        generation.record = null;
        if (!prepareInlineGeneration('fiction-prose', prompt)) return { ok: false, reason: 'no-editor' };
        generation.inProgress = true;
        generation.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        renderNativeGeneration();
        setNativeSaveStatus('生成中...', 'info');

        const startedAt = new Date().toISOString();
        let failureMessage = '';
        const requestConfig = { ...nativeGenerationConfig(generation.abortController && generation.abortController.signal), taskKind: 'writer-prose' };
        try {
            if (!desktopGenerationAvailable()) {
                throw new Error('Native generation provider stream is not loaded.');
            }
            await streamDesktopGeneration(prompt, (token, meta) => {
                if (meta && meta.type === 'finish') {
                    generation.finishReason = meta.finishReason || '';
                    return;
                }
                if (meta && meta.type === 'usage') {
                    generation.usage = { ...generation.usage, ...meta.usage };
                    return;
                }
                if (meta && meta.type === 'reasoning') generation.reasoning += token;
                else if (!meta || meta.type === 'content') {
                    generation.text += token;
                    syncInlineGenerationToEditor({ preserveFocus: true });
                }
                renderNativeGeneration();
            }, requestConfig);
            if (!generation.text.trim()) {
                generation.interruptReason = generation.reasoning ? 'empty' : 'failed';
                throw new Error('AI provider returned an empty response.');
            }

            const result = window.DraftHarborGenerationResult
                ? window.DraftHarborGenerationResult.createGenerationResult({
                    task: 'fiction-prose',
                    text: generation.text,
                    reasoning: generation.reasoning,
                    messages: prompt.messages || [],
                    startedAt,
                    finishedAt: new Date().toISOString()
                })
                : { text: generation.text, messages: prompt.messages || [] };
            const record = window.DraftHarborGenerationHistory
                ? window.DraftHarborGenerationHistory.createGenerationRecord({
                    projectId: snapshot.project && snapshot.project.id,
                    sceneId: scene.id,
                    task: 'fiction-prose',
                    beat: generation.beat,
                    messages: prompt.messages || [],
                    promptText: prompt.asString ? prompt.asString() : '',
                    resultText: result.text || generation.text,
                    reasoning: result.reasoning || '',
                    finishReason: generation.finishReason,
                    usage: generation.usage,
                    maxTokens: requestConfig.useProviderDefaults ? null : requestConfig.maxTokens
                })
                : { id: `generation-${Date.now()}`, beat: generation.beat, resultText: generation.text, createdAt: new Date().toISOString() };
            snapshot.promptHistory = snapshot.promptHistory || [];
            snapshot.promptHistory.push(record);
            generation.record = record;
            const truncated = generation.finishReason === 'length';
            flushNativeEditorFields();
            markNativeDirty(truncated
                ? '输出达到额度或上下文上限，已写入部分正文，未保存。请检查后重试'
                : '生成结果已写入正文，未保存');
            return { ok: !truncated, reason: truncated ? 'truncated' : undefined, record };
        } catch (error) {
            if (error && error.name === 'AbortError') {
                generation.interruptReason = 'cancelled';
                setNativeSaveStatus('生成已取消', 'info');
            } else {
                console.error('Native generation failed:', error);
                const normalized = window.DraftHarborGenerationResult
                    ? window.DraftHarborGenerationResult.normalizeGenerationError(error)
                    : { message: error && error.message ? error.message : String(error) };
                failureMessage = normalized.message;
                generation.errorMessage = normalized.message;
                if (!generation.interruptReason) generation.interruptReason = 'failed';
                setNativeSaveStatus(`生成失败：${normalized.message}`, 'error');
            }
            if (window.DraftHarborGenerationHistory) {
                const record = window.DraftHarborGenerationHistory.createGenerationRecord({
                    projectId: snapshot.project && snapshot.project.id,
                    sceneId: scene.id,
                    task: 'fiction-prose',
                    beat: generation.beat,
                    messages: prompt.messages || [],
                    resultText: generation.text,
                    reasoning: generation.reasoning,
                    finishReason: generation.finishReason,
                    usage: generation.usage,
                    maxTokens: requestConfig.useProviderDefaults ? null : requestConfig.maxTokens,
                    error: { code: error.code || (error.name === 'AbortError' ? 'aborted' : 'generation_error'), message: failureMessage || '生成已取消' }
                });
                snapshot.promptHistory = snapshot.promptHistory || [];
                snapshot.promptHistory.push(record);
                generation.record = record;
            }
        } finally {
            generation.inProgress = false;
            generation.abortController = null;
            renderNativeGeneration();
        }
        return { ok: false, reason: 'failed', message: failureMessage };
    }

    function showNativeRewritePreview() {
        const elements = nativeEditorElements();
        const prompt = buildNativeRewritePrompt();
        if (!prompt) {
            setNativeSaveStatus('请先在正文中选中文本', 'error');
            return;
        }
        if (elements.promptPreview) elements.promptPreview.textContent = prompt.asString();
        if (elements.promptDialog && typeof elements.promptDialog.showModal === 'function') {
            elements.promptDialog.showModal();
        }
    }

    let nativeAITaskRunner = null;

    function getNativeAITaskRunner() {
        if (nativeAITaskRunner) return nativeAITaskRunner;
        if (!window.DraftHarborAITaskRunner || typeof window.DraftHarborAITaskRunner.createAITaskRunner !== 'function') {
            return null;
        }
        nativeAITaskRunner = window.DraftHarborAITaskRunner.createAITaskRunner({
            streamGeneration(prompt, onToken, config) {
                return streamDesktopGeneration(prompt, onToken, config);
            }
        });
        return nativeAITaskRunner;
    }

    async function runNativeSelectionAITask(options) {
        const generation = nativeEditorState.generation;
        const snapshot = nativeEditorState.snapshot;
        const scene = options.scene;
        const prompt = options.prompt;
        const runner = getNativeAITaskRunner();
        if (!runner || !window.DraftHarborAITaskContract || !window.DraftHarborAITaskHistory) {
            setNativeSaveStatus(`${options.failurePrefix}：AI 任务执行器未加载`, 'error');
            return { ok: false, reason: 'missing-runner', message: 'AI 任务执行器未加载' };
        }

        if (generation.text && generation.inlineBaseText) restorePendingInlineGeneration();
        generation.task = options.action;
        generation.beat = prompt.instruction;
        generation.text = '';
        resetNativeGenerationStreamFlags(generation);
        generation.prompt = prompt;
        generation.record = null;
        generation.aiTaskRecord = null;
        generation.lastAcceptedSceneId = scene.id;
        generation.inlineBaseText = '';
        generation.pendingSceneId = '';
        generation.inProgress = true;
        generation.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

        const effectiveProfile = writerEffectiveProfile();
        const task = {
            projectId: snapshot.project && snapshot.project.id,
            domain: 'prose',
            action: options.action,
            target: { type: 'scene', sceneId: scene.id },
            scope: 'selection',
            presetId: options.action === 'rewrite' ? nativeEditorState.rewrite.preset : '',
            instruction: prompt.instruction,
            providerProfileId: writerModelOverride.profileId !== 'inherit' ? writerModelOverride.profileId : '',
            model: writerSelectedModelId(effectiveProfile),
            outputContract: 'text',
            beforeSnapshot: {
                sceneId: scene.id,
                selectionStart: nativeEditorState.rewrite.selectionStart,
                selectionEnd: nativeEditorState.rewrite.selectionEnd,
                originalText: nativeEditorState.rewrite.originalText
            }
        };
        generation.aiTaskTargetKey = window.DraftHarborAITaskContract.taskTargetKey(task);
        renderNativeGeneration();
        setNativeSaveStatus(options.startStatus, 'info');

        let result;
        try {
            result = await runner.run(task, {
                prompt,
                abortController: generation.abortController,
                providerConfig: nativeGenerationConfig(generation.abortController && generation.abortController.signal),
                onToken(state) {
                    generation.text = state.text;
                    generation.reasoning = state.reasoning;
                    generation.finishReason = state.finishReason || '';
                    generation.usage = state.usage || null;
                    renderNativeGeneration();
                }
            });
            if (!result.ok) {
                console.error(options.logLabel, result.error);
                const message = result.error && result.error.message ? result.error.message : 'AI 任务执行失败';
                generation.errorMessage = message;
                generation.aiTaskRecord = result.record;
                if (result.record) {
                    const partialRecord = window.DraftHarborAITaskHistory.toLegacyGenerationRecord(result.record, { sceneId: scene.id, task: options.action });
                    snapshot.promptHistory = snapshot.promptHistory || [];
                    snapshot.promptHistory.push(partialRecord);
                    generation.record = partialRecord;
                }
                generation.interruptReason = result.status === 'cancelled' ? 'cancelled' : 'failed';
                if (result.status === 'cancelled') setNativeSaveStatus('生成已取消', 'info');
                else setNativeSaveStatus(`${options.failurePrefix}：${message}`, 'error');
                return { ok: false, reason: result.status || 'failed', message };
            }

            generation.text = result.text;
            generation.reasoning = result.reasoning;
            const record = window.DraftHarborAITaskHistory.toLegacyGenerationRecord(result.record, {
                sceneId: scene.id,
                task: options.action,
                beat: prompt.instruction,
                resultText: result.text
            });
            snapshot.promptHistory = snapshot.promptHistory || [];
            snapshot.promptHistory.push(record);
            generation.record = record;
            generation.aiTaskRecord = result.record;
            generation.lastAcceptedSceneId = scene.id;
            setNativeSaveStatus(options.successStatus, 'ok');
            return { ok: true, record, aiTaskRecord: result.record };
        } finally {
            generation.inProgress = false;
            generation.abortController = null;
            generation.aiTaskTargetKey = '';
            renderNativeGeneration();
        }
    }

    async function startNativeRewrite() {
        const elements = nativeEditorElements();
        if (elements.rewritePreset) nativeEditorState.rewrite.preset = elements.rewritePreset.value || 'polish';
        if (elements.rewriteInstruction) nativeEditorState.rewrite.instruction = elements.rewriteInstruction.value || '';
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(() => null);
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        var prompt = buildNativeRewritePrompt();
        var scene = currentNativeScene();
        if (!prompt || !scene) {
            setNativeSaveStatus('请先在正文中选中文本', 'error');
            return { ok: false, reason: 'no-selection' };
        }
        var generation = nativeEditorState.generation;
        if (generation.inProgress) return { ok: false, reason: 'in-progress' };
        return runNativeSelectionAITask({
            action: 'rewrite',
            prompt,
            scene,
            startStatus: '改写中...',
            successStatus: '改写完成',
            failurePrefix: '改写失败',
            logLabel: 'Native rewrite failed:'
        });
    }

    async function startNativeRegenerateSelection() {
        var elements = nativeEditorElements();
        if (elements.rewriteInstruction) nativeEditorState.rewrite.instruction = elements.rewriteInstruction.value || '';
        if (elements.regenerateUseContext) {
            nativeEditorState.rewrite.regenerateUseContext = elements.regenerateUseContext.checked !== false;
        }
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(function () { return null; });
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        var prompt = buildNativeRegenerateSelectionPrompt();
        var scene = currentNativeScene();
        if (!prompt || !scene) {
            setNativeSaveStatus('请先在正文中选中要重生成的文本', 'error');
            return { ok: false, reason: 'no-selection' };
        }
        var generation = nativeEditorState.generation;
        if (generation.inProgress) return { ok: false, reason: 'in-progress' };
        return runNativeSelectionAITask({
            action: 'regenerate-selection',
            prompt,
            scene,
            startStatus: '正在重生成选区...',
            successStatus: '选区重生成完成',
            failurePrefix: '选区重生成失败',
            logLabel: 'Native selection regeneration failed:'
        });
    }

    function cleanNativeSummaryText(value) {
        let text = String(value || '');
        // Some OpenAI-compatible endpoints place hidden reasoning in content instead
        // of a dedicated reasoning stream. Keep only the visible answer in that case.
        text = text.replace(/<(think|analysis)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '');
        text = text.replace(/<(think|analysis)(?:\s[^>]*)?>[\s\S]*$/gi, '');
        return text.replace(/<\/?(?:think|analysis)(?:\s[^>]*)?>/gi, '').trim();
    }

    async function generateNativeSummary(scope) {
        if (settingsState.loading && settingsState.loadPromise) {
            await settingsState.loadPromise.catch(() => null);
        } else if (!settingsState.runtimeProvider) {
            await loadSettings();
        }
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const chapter = currentNativeChapterByState();
        const snapshot = nativeEditorState.snapshot;
        const generation = nativeEditorState.generation;
        if (!snapshot || !scene || !chapter || generation.inProgress) return;
        if (generation.text && generation.task !== 'summary') {
            setNativeSaveStatus('请先保留或撤回当前生成结果，再生成摘要。', 'info');
            return;
        }
        flushNativeEditorFields();
        let sourceText = '';
        let targetTitle = '';
        let sourceInfo = null;
        if (scope === 'chapter') {
            const chapterScenes = (nativeEditorState.snapshot.scenes || [])
                .filter((item) => item.chapterId === chapter.id)
                .sort((a, b) => (a.order || 0) - (b.order || 0));
            const sourceBuilder = window.DraftHarborSummarySource;
            sourceInfo = sourceBuilder && typeof sourceBuilder.buildChapterSummarySource === 'function'
                ? sourceBuilder.buildChapterSummarySource({ scenes: chapterScenes, getContent: nativeSceneContent })
                : { text: chapterScenes.map((item) => `${item.title || '未命名场景'}\n${(!item.summaryStale && item.summary) || nativeSceneContent(item.id)}`).join('\n\n'), compressed: false };
            sourceText = sourceInfo.text;
            targetTitle = chapter.title || '当前章节';
        } else {
            sourceText = nativeSceneContent(scene.id).trim();
            targetTitle = scene.title || '当前场景';
        }
        if (!sourceText.trim()) {
            setNativeSaveStatus('没有可总结的正文', 'error');
            return;
        }
        const summaryTemplate = typeof selectedSummaryPromptTemplate === 'function'
            ? selectedSummaryPromptTemplate(scope)
            : { title: '默认摘要模板', systemContent: '', content: '' };
        const prompt = {
            messages: [
                { role: 'system', content: ['你是小说编辑助手。请只输出简洁、准确、可用于后续上下文检索的摘要正文。不要加入评价，也不要输出思考过程、分析、推理步骤或 <think> 标签。', summaryTemplate.systemContent || '', nativeAvoidanceInstruction()].filter(Boolean).join('\n\n') },
                { role: 'user', content: [summaryTemplate.content || `请为“${targetTitle}”生成 ${scope === 'chapter' ? '章节' : '场景'}摘要。`, `对象：“${targetTitle}”。写一小段摘要即可，只记事实，不要写成正文。`, sourceInfo && sourceInfo.compressed ? '输入内容已按长度预算压缩；请仅依据提供内容概括，不要补写未提供的剧情。' : '', sourceText].filter(Boolean).join('\n\n') }
            ],
            asString() {
                return this.messages.map((message) => `<|im_start|>${message.role}\n${message.content}<|im_end|>`).join('\n');
            }
        };
        const sourceScenes = (snapshot.scenes || []).filter((item) => scope === 'chapter' ? item.chapterId === chapter.id : item.id === scene.id);
        const sourceContents = sourceScenes.map((item) => [item.id, String((snapshot.sceneContents || {})[item.id] || '')]);
        resetNativeGenerationStreamFlags(generation);
        generation.task = 'summary';
        generation.summaryScope = scope;
        generation.prompt = prompt;
        generation.record = null;
        generation.inlineBaseText = '';
        generation.pendingSceneId = '';
        generation.pendingEditorChanged = false;
        generation.insertionStart = 0;
        generation.insertionEnd = 0;
        generation.lastAcceptedSceneId = '';
        generation.inProgress = true;
        generation.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const isCurrentTask = () => nativeEditorState.snapshot === snapshot && nativeEditorState.generation === generation;
        renderNativeGeneration();
        setNativeSaveStatus(scope === 'chapter' ? '正在生成章节摘要...' : '正在生成场景摘要...', 'info');
        try {
            await streamDesktopGeneration(prompt, (token, meta) => {
                if (!isCurrentTask()) return;
                if (meta && meta.type === 'reasoning') generation.reasoning += token;
                else if (meta && meta.type === 'finish') generation.finishReason = meta.finishReason || '';
                else if (meta && meta.type === 'usage') generation.usage = { ...generation.usage, ...meta.usage };
                else if (!meta || !meta.type || meta.type === 'content') generation.summaryText += token;
                renderNativeGeneration();
            }, { ...nativeGenerationConfig(generation.abortController && generation.abortController.signal), taskKind: 'writer-summary' });
            if (!isCurrentTask()) return;
            const summary = cleanNativeSummaryText(generation.summaryText);
            if (generation.finishReason === 'length') throw new Error('摘要输出达到额度或上下文上限，请重试。');
            if (!summary) {
                generation.interruptReason = generation.reasoning ? 'empty' : 'failed';
                throw new Error('模型没有返回摘要内容。');
            }
            if (!(snapshot.scenes || []).includes(scene) || !(snapshot.chapters || []).includes(chapter)) {
                throw new Error('摘要对应的场景或章节已删除，请重新选择。');
            }
            const sourceChanged = sourceContents.some(([id, content]) => String((snapshot.sceneContents || {})[id] || '') !== content);
            if (scope === 'chapter') {
                chapter.summary = summary;
                chapter.summaryUpdated = new Date().toISOString();
                chapter.summarySource = 'ai';
                chapter.summaryStale = sourceChanged;
            } else {
                scene.summary = summary;
                scene.summaryUpdated = new Date().toISOString();
                scene.summarySource = 'ai';
                scene.summaryStale = sourceChanged;
                if (nativeEditorState.activeSceneId === scene.id && elements.summary) elements.summary.value = summary;
                markNativeChapterSummaryStale(scene.chapterId);
            }
            generation.summaryText = summary;
            generation.summaryCompleted = true;
            const status = scope === 'chapter'
                ? `章节摘要已生成${sourceInfo && sourceInfo.compressed ? '（输入已压缩）' : ''}，未保存`
                : '场景摘要已生成，未保存';
            markNativeDirty(status);
            renderNativeEditor();
            if (nativeEditorState.activeSceneId === scene.id) openNativeSummaryDialog(scope);
        } catch (error) {
            if (!isCurrentTask()) return;
            if (error && error.name === 'AbortError') {
                generation.interruptReason = 'cancelled';
                setNativeSaveStatus('摘要生成已停止', 'info');
            } else {
                console.error('Native summary failed:', error);
                generation.interruptReason = generation.interruptReason || 'failed';
                generation.errorMessage = error.message || String(error);
                setNativeSaveStatus(`摘要生成失败：${generation.errorMessage}`, 'error');
            }
        } finally {
            generation.inProgress = false;
            generation.abortController = null;
            if (isCurrentTask()) renderNativeGeneration();
        }
    }

    function acceptNativeGeneration() {
        const elements = nativeEditorElements();
        const scene = currentNativeScene();
        const generation = nativeEditorState.generation;
        if (!scene || !generation.text || !elements.editor) return;
        if (!isNativePendingInlineValueStable(elements)) {
            generation.pendingEditorChanged = true;
            syncNativeGenerationLayer();
            setNativeSaveStatus('正文已修改，无法安全确认，请重新生成或先撤回。', 'error');
            renderNativeGeneration();
            return;
        }
        syncInlineGenerationToEditor();
        elements.editor.selectionStart = generation.insertionStart + formatInlineGeneratedText(generation.text || '').length;
        elements.editor.selectionEnd = elements.editor.selectionStart;
        generation.lastAcceptedSceneId = scene.id;
        generation.text = '';
        resetNativeGenerationStreamFlags(generation);
        generation.inlineBaseText = '';
        generation.pendingSceneId = '';
        generation.pendingEditorChanged = false;
        flushNativeEditorFields();
        markNativeDirty('已保留生成内容，未保存');
        renderNativeEditor();
        renderNativeGeneration();
    }

    function discardNativeGeneration() {
        const elements = nativeEditorElements();
        const generation = nativeEditorState.generation;
        if (elements.editor && generation.pendingSceneId === nativeEditorState.activeSceneId && generation.inlineBaseText) {
            elements.editor.value = generation.inlineBaseText;
            flushNativeEditorFields();
            markNativeDirty('已撤回生成内容，未保存');
        }
        generation.text = '';
        resetNativeGenerationStreamFlags(generation);
        generation.inlineBaseText = '';
        generation.pendingSceneId = '';
        generation.pendingEditorChanged = false;
        generation.task = '';
        renderNativeGeneration();
        setNativeSaveStatus('已撤回生成内容', 'info');
    }

    function acceptNativeRewrite() {
        var elements = nativeEditorElements();
        var scene = currentNativeScene();
        var generation = nativeEditorState.generation;
        if (!scene || !generation.text || !elements.editor) return;
        if (generation.lastAcceptedSceneId && generation.lastAcceptedSceneId !== scene.id) {
            setNativeSaveStatus('已切换场景，改写结果已失效。请回到原场景或重新执行改写。', 'error');
            return;
        }
        var origStart = nativeEditorState.rewrite.selectionStart;
        var origEnd = nativeEditorState.rewrite.selectionEnd;
        var origText = nativeEditorState.rewrite.originalText || '';
        var currentSelection = elements.editor.value.slice(origStart, origEnd);
        if (origText && currentSelection !== origText) {
            setNativeSaveStatus('原文已发生变化，无法安全替换。请重新选中并执行改写。', 'error');
            return;
        }
        if (origStart < origEnd) {
            var before = elements.editor.value.slice(0, origStart);
            var after = elements.editor.value.slice(origEnd);
            var replacement = generation.text || '';
            elements.editor.value = before + replacement + after;
            elements.editor.selectionStart = origStart;
            elements.editor.selectionEnd = origStart + replacement.length;
            elements.editor.focus();
            flushNativeEditorFields();
            markNativeDirty('已接受改写结果，未保存');
        }
        generation.lastAcceptedSceneId = scene.id;
        generation.text = '';
        resetNativeGenerationStreamFlags(generation);
        generation.inlineBaseText = '';
        generation.pendingSceneId = '';
        generation.pendingEditorChanged = false;
        generation.task = '';
        nativeEditorState.rewrite.originalText = '';
        nativeEditorState.rewrite.selectionStart = 0;
        nativeEditorState.rewrite.selectionEnd = 0;
        renderNativeEditor();
        renderNativeGeneration();
        setNativeSaveStatus('已接受改写结果', 'ok');
    }

    function cancelNativeGeneration() {
        const generation = nativeEditorState.generation;
        const runner = getNativeAITaskRunner();
        if (runner && generation.aiTaskTargetKey && runner.cancel(generation.aiTaskTargetKey)) return;
        const controller = generation.abortController;
        if (controller) controller.abort();
    }

    async function openDesktopProject(project, options) {
        if (window.WorkshopAgent && !window.WorkshopAgent.canLeave()) return;
        if (project && project.health === 'invalid') {
            setProjectLibraryStatus('这个项目文件暂时无法读取，请先检查磁盘快照。', 'error');
            return;
        }

        setProjectLibraryStatus(`正在打开《${project.name || '未命名项目'}》...`, 'info');
        setView((options && options.view) || 'writer');

        const snapshot = await fetchProjectSnapshot(project);
        if (window.WorkshopAgent && !window.WorkshopAgent.canLeave()) return;
        loadNativeProjectEditor(snapshot, project || {});
        await loadReaderFromProjectSnapshot(snapshot);
        await loadCompendium();
        await loadPrompts();
        await loadRewritePrompts();
        await loadSummaryPrompts();
        await loadWorkshopSessions();
        await loadWorkflowRuns();

        setProjectLibraryStatus('', 'ok');
    }
