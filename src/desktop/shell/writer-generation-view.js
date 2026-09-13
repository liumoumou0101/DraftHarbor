    function writerThinkingControl() {
        const catalog = modelCatalog();
        const profile = writerEffectiveProfile();
        const model = writerSelectedModelId(profile);
        if (catalog.getThinkingControl) return catalog.getThinkingControl(profile.provider, model);
        return catalog.isThinkingSupported(profile.provider, model) ? 'toggle' : 'none';
    }

    function nativeWriterThinkingActive() {
        const control = writerThinkingControl();
        if (control === 'always-on') return true;
        if (control !== 'toggle' && control !== 'toggle-adaptive' && control !== 'responses-effort') return false;
        if (writerModelOverride.model === 'inherit') {
            const globalConfig = runtimeProviderConfig();
            if (globalConfig && globalConfig.enableThinking) return true;
        }
        return !!writerModelOverride.thinking;
    }

    function resetNativeGenerationStreamFlags(generation) {
        generation.text = '';
        generation.reasoning = '';
        generation.finishReason = '';
        generation.usage = null;
        generation.errorMessage = '';
        generation.interruptReason = '';
        generation.reasoningUserCollapsed = true;
        generation.reasoningExpanded = false;
        generation.reasoningFollowLatest = true;
        generation.reasoningRenderVersion = (generation.reasoningRenderVersion || 0) + 1;
        generation.summaryText = '';
        generation.summaryCompleted = false;
        generation.summaryScope = '';
        generation.aiTaskRecord = null;
        generation.aiTaskTargetKey = '';
    }

    function nativeReasoningPhase(generation, thinkingActive) {
        if (generation.interruptReason === 'cancelled') return 'cancelled';
        if (!generation.inProgress && generation.finishReason === 'length') return 'truncated';
        if (generation.interruptReason === 'failed') return 'failed';
        if (generation.interruptReason === 'empty') return 'empty';
        if (generation.inProgress && (generation.text || generation.summaryText)) return 'answer';
        if (generation.inProgress && generation.reasoning) return 'thinking';
        if (generation.inProgress && thinkingActive) return 'waiting';
        if (generation.finishReason === 'length') return 'truncated';
        if (generation.reasoning) return 'complete';
        return 'idle';
    }

    function nativeReasoningSummaryLabel(phase, charCount, task) {
        const count = charCount > 0 ? ` · ${charCount} 字` : '';
        if (phase === 'waiting') return `推理/思考 · 等待思考流${count}`;
        if (phase === 'thinking') return `推理/思考 · 进行中${count}`;
        if (phase === 'answer') return `推理/思考 · 已完成，正在生成${task === 'summary' ? '摘要' : '正文'}${count}`;
        if (phase === 'complete') return `推理/思考 · 已完成${count}`;
        if (phase === 'cancelled') return `推理/思考 · 已中断（已取消）${count}`;
        if (phase === 'failed') return `推理/思考 · 已中断（失败）${count}`;
        if (phase === 'empty') return `推理/思考 · 已中断（无正文）${count}`;
        if (phase === 'truncated') return `推理/思考 · 额度用尽，可能不完整${count}`;
        return charCount > 0 ? `推理/思考${count}` : '推理/思考';
    }

    function nativeReasoningDisplayText(generation, phase, thinkingActive) {
        let text = generation.reasoning || '';
        if (!text && phase === 'waiting' && generation.inProgress && thinkingActive) text = '等待模型返回思考过程…';
        if (phase === 'cancelled') return `${text}\n\n—— 思考已中断：生成已取消 ——`;
        if (phase === 'failed') return `${text}\n\n—— 思考已中断：生成失败 ——`;
        if (phase === 'empty') return `${text}\n\n—— 思考已结束，但没有返回正文 ——`;
        if (phase === 'truncated') return `${text}\n\n—— 输出因额度用尽被截断，思考过程可能不完整 ——`;
        return text;
    }

    function nativeReasoningElements() {
        return {
            ...nativeEditorElements(),
            writer: document.querySelector('[data-native-writer]'),
            inlineHost: document.querySelector('[data-native-reasoning-inline-host]'),
            dock: document.querySelector('[data-native-reasoning-dock]'),
            toggle: document.querySelector('[data-native-reasoning-toggle]'),
            copy: document.querySelector('[data-native-reasoning-copy]'),
            feedback: document.querySelector('[data-native-reasoning-feedback]'),
            latest: document.querySelector('[data-native-reasoning-latest]'),
            stop: document.querySelector('[data-native-stop-generation]'),
            confirmActions: document.querySelector('[data-native-generation-confirm-actions]')
        };
    }

    function syncNativeReasoningBubbleLayout() {
        const elements = nativeReasoningElements();
        const output = elements.generationOutput;
        const details = elements.reasoning;
        const pre = elements.reasoningText;
        const useDock = !!(elements.writer && elements.dock
            && !elements.writer.classList.contains('is-focus-mode')
            && !elements.writer.classList.contains('is-assistant-collapsed'));
        const host = useDock ? elements.dock : elements.inlineHost;
        let movedScrollTop = null;
        if (details && host && details.parentElement !== host) {
            movedScrollTop = pre ? pre.scrollTop : 0;
            const selection = window.getSelection && window.getSelection();
            const ranges = [];
            if (pre && selection) {
                for (let index = 0; index < selection.rangeCount; index += 1) {
                    const range = selection.getRangeAt(index);
                    if (pre.contains(range.startContainer) && pre.contains(range.endContainer)) {
                        ranges.push([range.startContainer, range.startOffset, range.endContainer, range.endOffset]);
                    }
                }
            }
            host.appendChild(details);
            if (ranges.length && selection) {
                selection.removeAllRanges();
                ranges.forEach(([start, startOffset, end, endOffset]) => {
                    const range = document.createRange();
                    range.setStart(start, startOffset);
                    range.setEnd(end, endOffset);
                    selection.addRange(range);
                });
            }
        }
        const expanded = !!(details && !details.hidden && details.open);
        if (elements.dock) elements.dock.hidden = !useDock || !expanded;
        if (elements.inlineHost) elements.inlineHost.hidden = useDock || !expanded;
        if (pre && movedScrollTop !== null) pre.scrollTop = movedScrollTop;
        if (elements.toggle) {
            elements.toggle.hidden = !details || details.hidden;
            elements.toggle.textContent = expanded ? '收起思考' : '查看思考';
            elements.toggle.setAttribute('aria-expanded', String(expanded));
        }
        if (output) {
            output.classList.toggle('is-reasoning-expanded', expanded && !useDock);
            output.classList.toggle('is-reasoning-interrupted', ['cancelled', 'failed', 'empty', 'truncated'].includes(output.dataset.reasoningPhase));
        }
        if (output && !output.hidden && !output.classList.contains('is-generation-output-dragging')
            && typeof window.queueNativeGenerationOutputPosition === 'function') {
            window.queueNativeGenerationOutputPosition();
        }
    }

    function bindNativeReasoningControls() {
        const elements = nativeReasoningElements();
        const bind = (element, eventName, key, callback) => {
            if (!element || element.dataset[key] === 'true') return;
            element.dataset[key] = 'true';
            element.addEventListener(eventName, callback);
        };
        const scrollLatest = () => {
            nativeEditorState.generation.reasoningFollowLatest = true;
            const pre = nativeReasoningElements().reasoningText;
            if (pre) pre.scrollTop = pre.scrollHeight;
        };
        bind(elements.reasoning, 'toggle', 'nativeReasoningToggleBound', () => {
            const details = nativeReasoningElements().reasoning;
            const generation = nativeEditorState.generation;
            generation.reasoningExpanded = !!details.open;
            generation.reasoningUserCollapsed = !details.open;
            syncNativeReasoningBubbleLayout();
        });
        bind(elements.toggle, 'click', 'nativeReasoningToggleButtonBound', () => {
            const details = nativeReasoningElements().reasoning;
            if (!details || details.hidden) return;
            const generation = nativeEditorState.generation;
            generation.reasoningExpanded = !details.open;
            generation.reasoningUserCollapsed = !generation.reasoningExpanded;
            details.open = generation.reasoningExpanded;
            syncNativeReasoningBubbleLayout();
        });
        bind(elements.reasoningText, 'scroll', 'nativeReasoningScrollBound', () => {
            const pre = nativeReasoningElements().reasoningText;
            if (!pre || !pre.clientHeight) return;
            nativeEditorState.generation.reasoningFollowLatest = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 48;
        });
        bind(elements.latest, 'click', 'nativeReasoningLatestBound', scrollLatest);
        bind(elements.copy, 'click', 'nativeReasoningCopyBound', async () => {
            const generation = nativeEditorState.generation;
            const version = generation.reasoningRenderVersion;
            const text = generation.reasoning || '';
            if (!text) return;
            const report = (message) => {
                if (nativeEditorState.generation !== generation || generation.reasoningRenderVersion !== version) return;
                const feedback = nativeReasoningElements().feedback;
                if (feedback) feedback.textContent = message;
                else setNativeSaveStatus(message, 'info');
            };
            try {
                if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('当前环境不支持剪贴板');
                await navigator.clipboard.writeText(text);
                report('已复制');
            } catch (error) {
                report('复制失败，请重试');
            }
        });
        bind(elements.stop, 'click', 'nativeReasoningStopBound', cancelNativeGeneration);
    }

    function renderNativeReasoning(generation, phase, thinkingActive) {
        const elements = nativeReasoningElements();
        const details = elements.reasoning;
        const pre = elements.reasoningText;
        const showReasoning = !!generation.reasoning || (thinkingActive && generation.inProgress && !generation.text && !generation.summaryText);
        const newTask = !!(pre && (pre.__nativeReasoningGeneration !== generation || pre.__nativeReasoningVersion !== generation.reasoningRenderVersion));
        bindNativeReasoningControls();
        if (newTask && elements.feedback) elements.feedback.textContent = '';
        if (details) {
            details.hidden = !showReasoning;
            details.dataset.phase = phase;
            if (newTask && details.open !== !!generation.reasoningExpanded) details.open = !!generation.reasoningExpanded;
            generation.reasoningExpanded = !!details.open;
            generation.reasoningUserCollapsed = !details.open;
        }
        if (elements.reasoningSummary) elements.reasoningSummary.textContent = nativeReasoningSummaryLabel(phase, (generation.reasoning || '').length, generation.task);
        if (elements.copy) elements.copy.disabled = !generation.reasoning;
        if (elements.latest) elements.latest.disabled = !generation.reasoning;
        if (pre) {
            const nextText = nativeReasoningDisplayText(generation, phase, thinkingActive);
            const oldText = pre.textContent || '';
            const selection = window.getSelection && window.getSelection();
            const hasSelection = !!(selection && !selection.isCollapsed
                && (pre.contains(selection.anchorNode) || pre.contains(selection.focusNode)));
            const wasNearBottom = !pre.clientHeight || pre.scrollHeight - pre.scrollTop - pre.clientHeight < 48;
            const shouldFollow = generation.reasoningFollowLatest !== false && wasNearBottom && !hasSelection;
            const previousScroll = pre.scrollTop;
            if (newTask || nextText !== oldText) {
                if (!newTask && nextText.startsWith(oldText)) pre.appendChild(document.createTextNode(nextText.slice(oldText.length)));
                else pre.textContent = nextText;
                pre.__nativeReasoningGeneration = generation;
                pre.__nativeReasoningVersion = generation.reasoningRenderVersion;
                if (newTask) pre.scrollTop = 0;
                else if (details && details.open && !details.hidden && shouldFollow) pre.scrollTop = pre.scrollHeight;
                else pre.scrollTop = previousScroll;
            }
        }
        syncNativeReasoningBubbleLayout();
    }

    function syncNativeComposerExpansion(expanded) {
        const writer = document.querySelector('[data-native-writer]');
        if (!writer) return;
        const userSet = writer.style.getPropertyValue('--native-assistant-height');
        if (!writer.classList.contains('is-assistant-bottom') || userSet) {
            writer.classList.remove('is-composer-expanded');
            return;
        }
        writer.classList.toggle('is-composer-expanded', !!expanded);
    }

    function autosizeNativeBeatInput() {
        const input = nativeEditorElements().beatInput;
        if (!input) return;
        input.style.height = '';
        input.style.overflowY = 'auto';
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
        const isSummaryTask = generation.task === 'summary';
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
            autosizeNativeBeatInput();
        }
        const isBeat = generation.genTask === 'beat';
        const canGenerate = !!scene && !generation.inProgress && (isBeat ? !!generation.beat.trim() : true);
        const isSummary = generation.genTask === 'summary';
        const previewDisabled = !scene || generation.inProgress || isSummary || (isBeat && !generation.beat.trim());
        (elements.previewPrompts && elements.previewPrompts.length ? elements.previewPrompts : (elements.previewPrompt ? [elements.previewPrompt] : [])).forEach((button) => {
            button.disabled = previewDisabled;
        });
        if (elements.generate) elements.generate.disabled = !canGenerate;
        if (elements.cancelGeneration) {
            elements.cancelGeneration.hidden = !generation.inProgress;
            elements.cancelGeneration.disabled = !generation.inProgress;
        }
        const thinkingActive = nativeWriterThinkingActive();
        const reasoningPhase = nativeReasoningPhase(generation, thinkingActive);
        const showGenerationOutput = !!generation.text || generation.inProgress || !!generation.reasoning
            || !!generation.interruptReason || !!generation.errorMessage || !!generation.summaryCompleted;
        if (elements.editorBody) elements.editorBody.classList.toggle('has-generation-output', showGenerationOutput);
        if (elements.generationOutput) {
            elements.generationOutput.hidden = !showGenerationOutput;
            elements.generationOutput.classList.toggle('is-inline-confirmation', showGenerationOutput && !isPreviewTask);
            elements.generationOutput.dataset.reasoningPhase = reasoningPhase;
        }
        const outputTitle = document.querySelector('[data-native-generation-output-title]');
        if (outputTitle) {
            if (generation.inProgress) {
                outputTitle.textContent = reasoningPhase === 'waiting' || reasoningPhase === 'thinking'
                    ? '正在思考' : (isSummaryTask ? '正在生成摘要' : '正在生成');
            } else if (generation.interruptReason === 'cancelled') {
                outputTitle.textContent = '生成已停止';
            } else if (generation.finishReason === 'length') {
                outputTitle.textContent = '结果不完整';
            } else if (generation.interruptReason || generation.errorMessage) {
                outputTitle.textContent = '生成失败';
            } else if (isSummaryTask && generation.summaryCompleted) {
                outputTitle.textContent = '摘要已生成';
            } else {
                outputTitle.textContent = generation.task === 'regenerate-selection' ? '重生成结果待确认' : '生成结果待确认';
            }
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
                if (isSummaryTask && generation.summaryText) {
                    elements.generationOutputStatus.textContent = '正在整理摘要…';
                } else if (generation.reasoning && !generation.text) {
                    elements.generationOutputStatus.textContent = '模型正在思考，可展开查看。';
                } else if (generation.text && !isPreviewTask) {
                    elements.generationOutputStatus.textContent = '正在正文中生成，确认后保留，撤回会恢复原文。';
                } else if (generation.text) {
                    elements.generationOutputStatus.textContent = '正在生成预览...';
                } else if (thinkingActive) {
                    elements.generationOutputStatus.textContent = '等待模型返回内容…';
                } else {
                    elements.generationOutputStatus.textContent = '正在生成，完成后可保留、重试或撤回。';
                }
            } else if (generation.finishReason === 'length') {
                elements.generationOutputStatus.textContent = '输出达到额度或上下文上限，结果不完整。已保留收到的内容；请检查后决定保留或重试。';
            } else if (generation.interruptReason) {
                elements.generationOutputStatus.textContent = generation.errorMessage || (generation.interruptReason === 'cancelled'
                    ? '生成已取消，已收到的内容可能不完整。'
                    : '生成中断，已收到的内容可能不完整，请检查后重试。');
            } else if (isSummaryTask) {
                elements.generationOutputStatus.textContent = '摘要已更新，可在文档信息中查看。';
            } else if (isPreviewTask) {
                elements.generationOutputStatus.textContent = '确认后替换原文，撤回保持原文。';
            } else {
                elements.generationOutputStatus.textContent = '已写入正文，确认后保留，撤回可恢复原文。';
            }
        }
        if (elements.generationResult) {
            elements.generationResult.hidden = !isPreviewTask;
            const resultText = generation.text || (generation.inProgress && isPreviewTask ? '生成中...' : '');
            if (elements.generationResult.textContent !== resultText) elements.generationResult.textContent = resultText;
        }
        renderNativeReasoning(generation, reasoningPhase, thinkingActive);
        const reasoningElements = nativeReasoningElements();
        if (reasoningElements.stop) {
            reasoningElements.stop.hidden = !generation.inProgress;
            reasoningElements.stop.disabled = !generation.inProgress;
        }
        if (reasoningElements.confirmActions) reasoningElements.confirmActions.hidden = !!generation.inProgress;
        if (elements.acceptGeneration) {
            elements.acceptGeneration.hidden = isSummaryTask;
            elements.acceptGeneration.disabled = !generation.text || generation.inProgress;
        }
        if (elements.retryGeneration) {
            const needsBeat = generation.genTask === 'beat';
            elements.retryGeneration.disabled = generation.inProgress || (needsBeat && !generation.beat.trim());
        }
        if (elements.discardGeneration) {
            elements.discardGeneration.disabled = generation.inProgress || !showGenerationOutput;
            elements.discardGeneration.textContent = !generation.text ? '关闭' : '撤回';
        }
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
            const historyLimit = nativeEditorState.historyDisplayLimit || 20;
            const records = filtered.slice(-historyLimit).reverse();
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
                const count = document.createElement('span');
                count.textContent = `显示 ${records.length} / ${filtered.length} 条`;
                elements.historyToolbar.appendChild(count);
                if (records.length < filtered.length) {
                    const more = document.createElement('button');
                    more.type = 'button';
                    more.className = 'desktop-secondary-action';
                    more.textContent = '加载更早记录';
                    more.addEventListener('click', () => {
                        nativeEditorState.historyDisplayLimit = historyLimit + 20;
                        renderNativeGeneration();
                    });
                    elements.historyToolbar.appendChild(more);
                }
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
                    copy.textContent = '复制结果';
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
                    const promptDetails = document.createElement('details');
                    const promptSummary = document.createElement('summary');
                    promptSummary.textContent = '查看历史提示词';
                    const promptText = record.promptText || (record.messages || []).map(message => {
                        const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2);
                        return `[${message.role || 'message'}]\n${content || ''}`;
                    }).join('\n\n');
                    const promptBody = document.createElement('pre');
                    promptBody.className = 'desktop-native-history-prompt';
                    promptBody.tabIndex = 0;
                    promptBody.textContent = promptText || '这条旧记录未保存完整提示词。';
                    const copyPrompt = document.createElement('button');
                    copyPrompt.type = 'button';
                    copyPrompt.className = 'desktop-secondary-action';
                    copyPrompt.textContent = '复制历史提示词';
                    copyPrompt.disabled = !promptText;
                    copyPrompt.addEventListener('click', () => copyNativeHistoryRecord({ resultText: promptText }));
                    promptDetails.append(promptSummary, promptBody, copyPrompt);
                    item.append(promptDetails);
                    elements.generationHistory.appendChild(item);
                });
            }
        }
        if (elements.generationOutput && !elements.generationOutput.hidden && !elements.generationOutput.classList.contains('is-generation-output-dragging')) {
            if (typeof window.queueNativeGenerationOutputPosition === 'function') window.queueNativeGenerationOutputPosition();
        }
        queueNativeGenerationLayer();
    }
