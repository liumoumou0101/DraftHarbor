    const NATIVE_GENERATION_OUTPUT_POSITION_KEY = 'draftharbor:nativeGenerationOutputPosition';

    function readNativeGenerationOutputPosition() {
        try {
            const value = JSON.parse(window.localStorage.getItem(NATIVE_GENERATION_OUTPUT_POSITION_KEY) || 'null');
            if (!value || !Number.isFinite(Number(value.left)) || !Number.isFinite(Number(value.top))) return null;
            return { left: Number(value.left), top: Number(value.top) };
        } catch (error) { return null; }
    }

    function writeNativeGenerationOutputPosition(position) {
        if (!position) return;
        try {
            window.localStorage.setItem(NATIVE_GENERATION_OUTPUT_POSITION_KEY, JSON.stringify({
                left: Math.round(position.left), top: Math.round(position.top)
            }));
        } catch (error) { /* ignore */ }
    }

    function clearNativeGenerationOutputPosition() {
        try { window.localStorage.removeItem(NATIVE_GENERATION_OUTPUT_POSITION_KEY); } catch (error) { /* ignore */ }
    }

    function nativeGenerationOutputFooterReserve(bodyRect) {
        const footer = document.querySelector('[data-native-paper-footer]');
        if (!footer || window.getComputedStyle(footer).display === 'none') return 12;
        const footerRect = footer.getBoundingClientRect();
        return footerRect.height < 1 ? 12 : Math.max(12, bodyRect.bottom - footerRect.top + 8);
    }

    function clampNativeGenerationOutputPosition(position, bodyRect, outputRect) {
        const margin = 12;
        const bottomReserve = nativeGenerationOutputFooterReserve(bodyRect);
        const maxLeft = Math.max(margin, bodyRect.width - outputRect.width - margin);
        const maxTop = Math.max(margin, bodyRect.height - outputRect.height - bottomReserve);
        return {
            left: Math.min(maxLeft, Math.max(margin, Number(position.left) || 0)),
            top: Math.min(maxTop, Math.max(margin, Number(position.top) || 0))
        };
    }

    function defaultNativeGenerationOutputPosition(bodyRect, outputRect) {
        return clampNativeGenerationOutputPosition({
            left: bodyRect.width - outputRect.width - 12,
            top: 12
        }, bodyRect, outputRect);
    }

    function syncNativeGenerationOutputPosition(options = {}) {
        const elements = nativeEditorElements();
        const output = elements.generationOutput;
        const body = elements.editorBody;
        if (!output || !body || output.hidden) return null;
        const bodyRect = body.getBoundingClientRect();
        const outputRect = output.getBoundingClientRect();
        if (bodyRect.width < 1 || bodyRect.height < 1 || outputRect.width < 1 || outputRect.height < 1) return null;
        if (options.reset) clearNativeGenerationOutputPosition();
        const stored = options.reset ? null : readNativeGenerationOutputPosition();
        const inlineLeft = Number.parseFloat(output.style.left);
        const inlineTop = Number.parseFloat(output.style.top);
        const position = stored || (Number.isFinite(inlineLeft) && Number.isFinite(inlineTop)
            ? { left: inlineLeft, top: inlineTop }
            : defaultNativeGenerationOutputPosition(bodyRect, outputRect));
        const clamped = clampNativeGenerationOutputPosition(position, bodyRect, outputRect);
        output.style.left = `${Math.round(clamped.left)}px`;
        output.style.top = `${Math.round(clamped.top)}px`;
        output.style.right = 'auto';
        output.style.bottom = 'auto';
        output.style.transform = 'none';
        if (options.persist) writeNativeGenerationOutputPosition(clamped);
        return clamped;
    }

    function queueNativeGenerationOutputPosition() {
        const output = nativeEditorElements().generationOutput;
        if (!output || output.__nativeGenerationPositionFrame) return;
        const schedule = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : (callback) => window.setTimeout(callback, 0);
        output.__nativeGenerationPositionFrame = schedule(() => {
            output.__nativeGenerationPositionFrame = 0;
            syncNativeGenerationOutputPosition();
        });
    }

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
            if (layer) layer.hidden = true;
            if (content) content.replaceChildren();
            return false;
        }
        if (!isNativePendingInlineValueStable(elements)) {
            generation.pendingEditorChanged = true;
            layer.hidden = true;
            content.replaceChildren();
            if (elements.generationOutputStatus) {
                elements.generationOutputStatus.textContent = '正文已修改，无法直接确认；请重新生成或撤回。';
            }
            return false;
        }
        generation.pendingEditorChanged = false;
        const body = elements.editorBody;
        if (!body) return false;
        const bodyRect = body.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        if (bodyRect.width < 1 || bodyRect.height < 1 || editorRect.width < 1 || editorRect.height < 1) {
            layer.hidden = true;
            return false;
        }
        const computed = window.getComputedStyle(editor);
        layer.style.left = `${editorRect.left - bodyRect.left}px`;
        layer.style.top = `${editorRect.top - bodyRect.top}px`;
        layer.style.width = `${editorRect.width}px`;
        layer.style.height = `${editorRect.height}px`;
        layer.style.padding = '0';
        layer.style.boxSizing = computed.boxSizing;
        content.style.width = `${editor.clientWidth}px`;
        content.style.minHeight = `${Math.max(editor.scrollHeight, editor.clientHeight)}px`;
        content.style.padding = computed.padding;
        content.style.boxSizing = computed.boxSizing;
        content.style.font = computed.font;
        content.style.lineHeight = computed.lineHeight;
        content.style.letterSpacing = computed.letterSpacing;
        content.style.textAlign = computed.textAlign;
        content.style.textIndent = computed.textIndent;
        content.style.whiteSpace = computed.whiteSpace;
        content.style.wordBreak = computed.wordBreak;
        content.style.overflowWrap = computed.overflowWrap;
        content.style.tabSize = computed.tabSize;
        content.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;

        const value = editor.value || '';
        const inserted = formatInlineGeneratedText(generation.text || '');
        const start = Math.max(0, Math.min(value.length, generation.insertionStart));
        const end = Math.max(start, Math.min(value.length, start + inserted.length));
        const fragment = document.createDocumentFragment();
        const before = document.createElement('span');
        before.textContent = value.slice(0, start);
        const pending = document.createElement('mark');
        pending.className = 'desktop-native-editor-generation-mark';
        pending.textContent = value.slice(start, end);
        const after = document.createElement('span');
        after.textContent = value.slice(end);
        fragment.append(before, pending, after);
        content.replaceChildren(fragment);
        layer.hidden = false;
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
        editor.addEventListener('scroll', syncNativeGenerationLayer);
        window.addEventListener('resize', syncNativeGenerationLayer);
    }

    function bindNativeGenerationOutputDrag() {
        const elements = nativeEditorElements();
        const output = elements.generationOutput;
        const body = elements.editorBody;
        const labeledHandle = elements.generationOutputDragHandle
            || (output && output.querySelector('.desktop-native-generation-output-header'));
        if (!output || !body || output.dataset.nativeGenerationDragBound === 'true') return;
        output.dataset.nativeGenerationDragBound = 'true';
        let dragState = null;

        const ignoreDragFrom = (target) => !!(target && target.closest && target.closest(
            'button, a, textarea, input, select, summary, [data-native-generation-result], [data-native-reasoning]'
        ));

        const applyDragPosition = (left, top) => {
            const bodyRect = body.getBoundingClientRect();
            const outputRect = output.getBoundingClientRect();
            const next = clampNativeGenerationOutputPosition({ left, top }, bodyRect, outputRect);
            output.style.left = `${Math.round(next.left)}px`;
            output.style.top = `${Math.round(next.top)}px`;
            output.style.right = 'auto';
            output.style.bottom = 'auto';
            output.style.transform = 'none';
            return next;
        };

        const currentOutputOffset = () => {
            const left = Number.parseFloat(output.style.left);
            const top = Number.parseFloat(output.style.top);
            if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
            const bodyRect = body.getBoundingClientRect();
            const outputRect = output.getBoundingClientRect();
            return {
                left: outputRect.left - bodyRect.left,
                top: outputRect.top - bodyRect.top
            };
        };

        const finishDrag = (event) => {
            if (!dragState) return;
            dragState = null;
            output.classList.remove('is-generation-output-dragging');
            if (labeledHandle) labeledHandle.setAttribute('aria-grabbed', 'false');
            if (event && output.releasePointerCapture && output.hasPointerCapture && output.hasPointerCapture(event.pointerId)) {
                try { output.releasePointerCapture(event.pointerId); } catch (error) { /* ignore */ }
            }
            writeNativeGenerationOutputPosition(applyDragPosition(currentOutputOffset().left, currentOutputOffset().top));
        };

        const onPointerMove = (event) => {
            if (!dragState) return;
            event.preventDefault();
            applyDragPosition(
                dragState.position.left + event.clientX - dragState.clientX,
                dragState.position.top + event.clientY - dragState.clientY
            );
        };

        const onPointerUp = (event) => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            finishDrag(event);
        };

        output.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || output.hidden || ignoreDragFrom(event.target)) return;
            event.preventDefault();
            syncNativeGenerationOutputPosition();
            dragState = {
                clientX: event.clientX,
                clientY: event.clientY,
                position: currentOutputOffset()
            };
            output.classList.add('is-generation-output-dragging');
            if (labeledHandle) labeledHandle.setAttribute('aria-grabbed', 'true');
            if (output.setPointerCapture) {
                try { output.setPointerCapture(event.pointerId); } catch (error) { /* ignore synthetic pointer events */ }
            }
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        });

        output.addEventListener('pointermove', onPointerMove);
        output.addEventListener('pointerup', onPointerUp);
        output.addEventListener('pointercancel', onPointerUp);
        output.addEventListener('dblclick', (event) => {
            if (ignoreDragFrom(event.target)) return;
            event.preventDefault();
            if (dragState) finishDrag(event);
            syncNativeGenerationOutputPosition({ reset: true, persist: true });
        });
        window.addEventListener('resize', () => {
            if (!dragState) syncNativeGenerationOutputPosition({ persist: true });
        });
    }

    function renderNativeGeneration() {
        const elements = nativeEditorElements();
        const generation = nativeEditorState.generation;
        const scene = currentNativeScene();
        const snapshot = nativeEditorState.snapshot;
        const activeChapter = scene && snapshot && Array.isArray(snapshot.chapters)
            ? snapshot.chapters.find((chapter) => chapter.id === scene.chapterId)
            : null;
        const currentText = scene
            ? (elements.editor ? String(elements.editor.value || '') : nativeSceneContent(scene.id))
            : '';
        const wordCount = countNativeWords(currentText);
        if (elements.copilotGreeting) {
            elements.copilotGreeting.textContent = scene
                ? `继续处理《${scene.title || '未命名场景'}》`
                : '打开一个场景后开始创作';
        }
        if (elements.copilotBrief) {
            elements.copilotBrief.textContent = scene
                ? '选择一个创作动作，或直接写下下一段的方向。'
                : '从书库打开项目并选择场景后，AI 写作动作会在这里启用。';
        }
        if (elements.copilotScene) {
            elements.copilotScene.textContent = scene ? (scene.title || '未命名场景') : '未选择场景';
        }
        if (elements.copilotChapter) {
            elements.copilotChapter.textContent = activeChapter ? (activeChapter.title || '未命名章节') : '未选择章节';
        }
        if (elements.copilotWords) {
            elements.copilotWords.textContent = scene ? `${formatNumber(wordCount)} 字` : '0 字';
        }
        if (elements.copilotContextNote) {
            const context = nativeEditorState.context || {};
            const extraCount = (context.compendiumIds || []).length
                + (context.compendiumTags || []).length
                + Object.values(context.chapterModes || {}).filter(Boolean).length
                + Object.values(context.sceneModes || {}).filter(Boolean).length;
            elements.copilotContextNote.textContent = extraCount > 0 ? `${extraCount} 项额外引用` : '未选择额外引用';
        }
        const isPreviewTask = generation.task === 'rewrite' || generation.task === 'regenerate-selection';
        if (elements.genTaskButtons && elements.genTaskButtons.length) {
            elements.genTaskButtons.forEach((btn) => {
                const task = btn.getAttribute('data-native-gen-task');
                btn.classList.toggle('is-active', task === generation.genTask);
            });
        }
        if (elements.beatInput) {
            if (elements.beatInput.value !== generation.beat) {
                elements.beatInput.value = generation.beat;
            }
            const placeholders = {
                'continue': '输入这一段要发生什么，或写下续写方向（可选）',
                'beat': '输入节拍描述（必填）',
                'summary': '无需输入，直接生成场景摘要'
            };
            elements.beatInput.placeholder = placeholders[generation.genTask] || '输入这一段要发生什么，或写下续写方向（可选）';
        }
        const isBeat = generation.genTask === 'beat';
        const canGenerate = !!scene && !generation.inProgress && (isBeat ? !!generation.beat.trim() : true);
        if (elements.previewPrompt) {
            const isSummary = generation.genTask === 'summary';
            elements.previewPrompt.disabled = !scene || generation.inProgress || isSummary || (isBeat && !generation.beat.trim());
        }
        if (elements.generate) elements.generate.disabled = !canGenerate;
        if (elements.cancelGeneration) {
            elements.cancelGeneration.hidden = !generation.inProgress;
            elements.cancelGeneration.disabled = !generation.inProgress;
        }
        const showGenerationOutput = !!generation.text || generation.inProgress;
        if (elements.editorBody) elements.editorBody.classList.toggle('has-generation-output', showGenerationOutput);
        if (elements.generationOutput) {
            elements.generationOutput.hidden = !showGenerationOutput;
            elements.generationOutput.classList.toggle('is-inline-confirmation', showGenerationOutput && !isPreviewTask);
        }
        const outputTitle = document.querySelector('[data-native-generation-output-title]');
        if (outputTitle) {
            outputTitle.textContent = generation.task === 'regenerate-selection' ? '重生成结果待确认' : '生成结果待确认';
        }
        const costNote = document.querySelector('[data-native-generation-cost-note]');
        if (costNote) {
            const regenerateChars = typeof nativeRegenerateContextChars === 'function'
                ? nativeRegenerateContextChars()
                : Number(nativeEditorState.rewrite.regenerateContextChars) || 8000;
            const usedLongContext = generation.task === 'regenerate-selection'
                && nativeEditorState.rewrite.regenerateUseContext !== false
                && regenerateChars > 0;
            costNote.hidden = !usedLongContext;
            costNote.textContent = usedLongContext
                ? `这次是重生成：会发送选区前后各 ${regenerateChars} 字，输入费用高于改写。`
                : '';
        }
        if (elements.generationOutputStatus) {
            if (generation.inProgress) {
                if (generation.reasoning && !generation.text) {
                    elements.generationOutputStatus.textContent = '正在思考...';
                } else if (generation.inProgress && generation.text && !isPreviewTask) {
                    elements.generationOutputStatus.textContent = '正在正文中生成，确认后保留，撤回会恢复原文。';
                } else if (generation.inProgress && generation.text) {
                    elements.generationOutputStatus.textContent = '正在生成预览...';
                } else {
                    elements.generationOutputStatus.textContent = '正在生成，完成后可保留、重试或撤回。';
                }
            } else if (generation.finishReason === 'length') {
                elements.generationOutputStatus.textContent = isPreviewTask
                    ? '输出因额度用尽被截断。预览后可保留，或提高最大输出后重试。'
                    : '输出因额度用尽被截断，已写入正文。可撤回后提高最大输出再试。';
            } else if (isPreviewTask) {
                elements.generationOutputStatus.textContent = '确认后替换原文，撤回保持原文。';
            } else {
                elements.generationOutputStatus.textContent = '已写入正文，确认后保留，撤回可恢复原文。';
            }
        }
        if (elements.generationResult) {
            elements.generationResult.hidden = !isPreviewTask;
            elements.generationResult.textContent = generation.text || (generation.inProgress && isPreviewTask ? '生成中...' : '');
        }
        if (elements.reasoning) {
            var effectiveThinking = writerModelOverride.thinking;
            if (writerModelOverride.model === 'inherit') {
                const globalConfig = runtimeProviderConfig();
                effectiveThinking = !!(globalConfig && globalConfig.enableThinking);
            }
            elements.reasoning.hidden = !(effectiveThinking && generation.inProgress) && !generation.reasoning;
        }
        if (elements.reasoningText) {
            if (generation.reasoning) {
                elements.reasoningText.textContent = generation.reasoning;
            } else if (generation.inProgress && writerModelOverride.thinking) {
                elements.reasoningText.textContent = '等待思考流...';
            } else if (generation.inProgress && writerModelOverride.model === 'inherit') {
                const globalConfig = runtimeProviderConfig();
                if (globalConfig && globalConfig.enableThinking) {
                    elements.reasoningText.textContent = '等待思考流...';
                } else {
                    elements.reasoningText.textContent = '';
                }
            } else {
                elements.reasoningText.textContent = '';
            }
        }
        if (elements.acceptGeneration) elements.acceptGeneration.disabled = !generation.text || generation.inProgress;
        if (elements.retryGeneration) {
            const needsBeat = generation.genTask === 'beat';
            elements.retryGeneration.disabled = generation.inProgress || (needsBeat && !generation.beat.trim());
        }
        if (elements.discardGeneration) elements.discardGeneration.disabled = generation.inProgress || !generation.text;
        if (elements.insertMode) elements.insertMode.disabled = generation.inProgress || !generation.text;
        if (elements.lengthHint) {
            const hint = generation.lengthHint || 'natural';
            elements.lengthHint.value = hint;
            elements.lengthHint.disabled = generation.inProgress;
        }
        if (elements.promptTemplate) {
            elements.promptTemplate.replaceChildren();
            const prompts = promptState.prompts.length ? promptState.prompts : [{ id: 'default-prose', title: '均衡续写' }];
            prompts.forEach((prompt) => {
                const option = document.createElement('option');
                option.value = prompt.id;
                option.textContent = prompt.title || '未命名提示词';
                elements.promptTemplate.appendChild(option);
            });
            elements.promptTemplate.value = promptState.selectedId;
            elements.promptTemplate.disabled = !currentProjectId();
        }
        if (elements.managePrompts) elements.managePrompts.disabled = !currentProjectId();

        if (elements.generationHistory) {
            const allRecords = nativeGenerationHistory();
            const scene = currentNativeScene();
            const filtered = nativeEditorState.historySceneFilter && scene
                ? allRecords.filter((r) => r.sceneId === scene.id)
                : allRecords;
            const records = filtered.slice(-5).reverse();
            elements.generationHistory.replaceChildren();
            if (elements.historyToolbar) {
                elements.historyToolbar.replaceChildren();
                const filterToggle = document.createElement('button');
                filterToggle.type = 'button';
                filterToggle.className = 'desktop-native-history-filter-toggle';
                filterToggle.setAttribute('data-native-history-filter', '');
                filterToggle.textContent = '当前场景';
                filterToggle.setAttribute('aria-pressed', nativeEditorState.historySceneFilter ? 'true' : 'false');
                if (nativeEditorState.historySceneFilter) filterToggle.classList.add('is-active');
                filterToggle.addEventListener('click', () => {
                    nativeEditorState.historySceneFilter = !nativeEditorState.historySceneFilter;
                    renderNativeGeneration();
                });
                elements.historyToolbar.appendChild(filterToggle);
            }
            if (!records.length) {
                const empty = document.createElement('div');
                empty.className = 'desktop-native-history-item';
                empty.textContent = '暂无生成记录';
                elements.generationHistory.appendChild(empty);
            } else {
                const snapshot = nativeEditorState.snapshot;
                const scenes = (snapshot && Array.isArray(snapshot.scenes)) ? snapshot.scenes : [];
                const TASK_LABELS = {
                    'fiction-prose': '正文扩写',
                    'summary': '场景摘要',
                    'continue': '续写',
                    'beat': '节拍生成'
                };
                records.forEach((record) => {
                    const item = document.createElement('div');
                    item.className = 'desktop-native-history-item';
                    const taskLabel = document.createElement('div');
                    taskLabel.className = 'desktop-native-history-task-label';
                    taskLabel.setAttribute('data-native-history-task', '');
                    taskLabel.textContent = TASK_LABELS[record.task] || record.task || '生成';
                    const sceneName = scenes.find((s) => s.id === record.sceneId);
                    if (sceneName) {
                        taskLabel.textContent += ` · ${sceneName.title || sceneName.id}`;
                        taskLabel.title = sceneName.title || sceneName.id;
                    }
                    const title = document.createElement('strong');
                    title.textContent = record.beat || '未命名生成';
                    const meta = document.createElement('span');
                    meta.className = 'desktop-native-history-meta';
                    meta.setAttribute('data-native-history-meta', '');
                    const wc = countNativeWords(record.resultText || '');
                    meta.textContent = `${new Date(record.createdAt || Date.now()).toLocaleString('zh-CN')} · ${wc} 字`;
                    const preview = document.createElement('div');
                    preview.className = 'desktop-native-history-preview';
                    preview.setAttribute('data-native-history-preview', '');
                    const previewText = (record.resultText || '').trim();
                    preview.textContent = previewText.slice(0, 60) + (previewText.length > 60 ? '...' : '');
                    const actions = document.createElement('div');
                    actions.className = 'desktop-native-history-actions';
                    const reuse = document.createElement('button');
                    reuse.type = 'button';
                    reuse.textContent = '复用提示';
                    reuse.setAttribute('data-native-history-reuse', '');
                    reuse.addEventListener('click', () => {
                        generation.beat = record.beat || '';
                        generation.text = record.resultText || '';
                        generation.reasoning = record.reasoning || '';
                        generation.prompt = { messages: record.messages || [], asString: () => record.promptText || '' };
                        renderNativeGeneration();
                    });
                    const copy = document.createElement('button');
                    copy.type = 'button';
                    copy.textContent = '复制';
                    copy.setAttribute('data-native-history-copy', '');
                    copy.disabled = !record.resultText;
                    copy.addEventListener('click', () => copyNativeHistoryRecord(record));
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.textContent = '重试';
                    retry.setAttribute('data-native-history-retry', '');
                    retry.disabled = !scene;
                    retry.addEventListener('click', () => retryNativeHistoryRecord(record));
                    const insert = document.createElement('button');
                    insert.type = 'button';
                    insert.textContent = '写入';
                    insert.setAttribute('data-native-history-insert', '');
                    insert.disabled = !scene || !record.resultText;
                    insert.addEventListener('click', () => insertNativeHistoryRecord(record));
                    const remove = document.createElement('button');
                    remove.type = 'button';
                    remove.textContent = '删除';
                    remove.setAttribute('data-native-history-delete', '');
                    remove.addEventListener('click', () => deleteNativeHistoryRecord(record));
                    actions.append(reuse, copy, retry, insert, remove);
                    item.append(taskLabel, title, meta, preview, actions);
                    elements.generationHistory.appendChild(item);
                });
            }
        }
        if (elements.generationOutput && !elements.generationOutput.hidden && !elements.generationOutput.classList.contains('is-generation-output-dragging')) {
            queueNativeGenerationOutputPosition();
        }
        queueNativeGenerationLayer();
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
        generation.reasoning = '';
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
            projectDirectiveStack: nativeEditorState.snapshot && nativeEditorState.snapshot.directiveStack
        };
        if (writerModelOverride.profileId && writerModelOverride.profileId !== 'inherit') {
            extras.profileId = writerModelOverride.profileId;
        }
        if (writerModelOverride.model !== 'inherit' && selectedModel) {
            extras.model = selectedModel;
        }
        if (writerModelOverride.thinking && modelCatalog().isThinkingSupported(effectiveProfile.provider, selectedModel || effectiveProfile.model)) {
            extras.enableThinking = true;
        }
        const config = runtimeProviderConfig(extras);
        const schema = window.DraftHarborSettingsSchema;
        if (config && config.enableThinking && !config.useProviderDefaults && schema && typeof schema.thinkingOutputQuota === 'function') {
            const quota = schema.thinkingOutputQuota(config.maxTokens, true);
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

    function syncInlineGenerationToEditor() {
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
        elements.editor.focus();
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
        generation.reasoning = '';
        generation.finishReason = '';
        generation.prompt = prompt;
        generation.record = null;
        if (!prepareInlineGeneration('fiction-prose', prompt)) return { ok: false, reason: 'no-editor' };
        generation.inProgress = true;
        generation.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        renderNativeGeneration();
        setNativeSaveStatus('生成中...', 'info');

        const startedAt = new Date().toISOString();
        let failureMessage = '';
        try {
            if (!desktopGenerationAvailable()) {
                throw new Error('Native generation provider stream is not loaded.');
            }
            await streamDesktopGeneration(prompt, (token, meta) => {
                if (meta && meta.type === 'finish') {
                    generation.finishReason = meta.finishReason || '';
                    return;
                }
                if (meta && meta.type === 'reasoning') generation.reasoning += token;
                else if (!meta || meta.type === 'content') generation.text += token;
                syncInlineGenerationToEditor();
                renderNativeGeneration();
            }, { ...nativeGenerationConfig(generation.abortController && generation.abortController.signal), taskKind: 'writer-prose' });
            if (!generation.text.trim()) {
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
                    reasoning: result.reasoning || ''
                })
                : { id: `generation-${Date.now()}`, beat: generation.beat, resultText: generation.text, createdAt: new Date().toISOString() };
            snapshot.promptHistory = snapshot.promptHistory || [];
            snapshot.promptHistory.push(record);
            generation.record = record;
            const truncated = generation.finishReason === 'length';
            flushNativeEditorFields();
            markNativeDirty(truncated
                ? '输出因额度用尽被截断，已写入正文，未保存。可提高最大输出后重试'
                : '生成结果已写入正文，未保存');
            return { ok: true, record };
        } catch (error) {
            if (error && error.name === 'AbortError') {
                setNativeSaveStatus('生成已取消', 'info');
            } else {
                console.error('Native generation failed:', error);
                const normalized = window.DraftHarborGenerationResult
                    ? window.DraftHarborGenerationResult.normalizeGenerationError(error)
                    : { message: error && error.message ? error.message : String(error) };
                failureMessage = normalized.message;
                setNativeSaveStatus(`生成失败：${normalized.message}`, 'error');
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
        generation.reasoning = '';
        generation.finishReason = '';
        generation.prompt = prompt;
        generation.record = null;
        generation.aiTaskRecord = null;
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
                    renderNativeGeneration();
                }
            });
            if (!result.ok) {
                console.error(options.logLabel, result.error);
                const message = result.error && result.error.message ? result.error.message : 'AI 任务执行失败';
                setNativeSaveStatus(`${options.failurePrefix}：${message}`, 'error');
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
        if (!nativeEditorState.snapshot || !scene || !chapter) return;
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
        const generation = nativeEditorState.generation;
        if (generation.inProgress) return;
        generation.inProgress = true;
        generation.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        let summary = '';
        renderNativeGeneration();
        setNativeSaveStatus(scope === 'chapter' ? '正在生成章节摘要...' : '正在生成场景摘要...', 'info');
        try {
            await streamDesktopGeneration(prompt, (token, meta) => {
                if (meta && meta.type && meta.type !== 'content') return;
                summary += token;
                if (scope === 'scene' && elements.summary) elements.summary.value = summary;
            }, { ...nativeGenerationConfig(generation.abortController && generation.abortController.signal), taskKind: 'writer-summary' });
            summary = cleanNativeSummaryText(summary);
            if (!summary) throw new Error('AI provider returned an empty response.');
            if (scope === 'chapter') {
                chapter.summary = summary;
                chapter.summaryUpdated = new Date().toISOString();
                chapter.summarySource = 'ai';
                chapter.summaryStale = false;
            } else {
                scene.summary = summary;
                scene.summaryUpdated = new Date().toISOString();
                scene.summarySource = 'ai';
                scene.summaryStale = false;
                if (elements.summary) elements.summary.value = summary;
            }
            // Rendering metadata must retain the current writing target; otherwise the
            // chapter-summary action can become disabled after a scene summary completes.
            nativeEditorState.activeSceneId = scene.id;
            nativeEditorState.activeChapterId = chapter.id;
            const status = scope === 'chapter'
                ? `章节摘要已生成${sourceInfo && sourceInfo.compressed ? '（输入已压缩）' : ''}，未保存`
                : '场景摘要已生成，未保存';
            markNativeDirty(status);
            renderNativeEditor();
            openNativeSummaryDialog(scope);
        } catch (error) {
            console.error('Native summary failed:', error);
            setNativeSaveStatus(`摘要生成失败：${error.message || error}`, 'error');
        } finally {
            generation.inProgress = false;
            generation.abortController = null;
            renderNativeGeneration();
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
        generation.reasoning = '';
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
        generation.reasoning = '';
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
        generation.reasoning = '';
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
        if (project && project.health === 'invalid') {
            setProjectLibraryStatus('这个项目文件暂时无法读取，请先检查磁盘快照。', 'error');
            return;
        }

        setProjectLibraryStatus(`正在打开《${project.name || '未命名项目'}》...`, 'info');
        setView((options && options.view) || 'writer');

        const snapshot = await fetchProjectSnapshot(project);
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
