    let workflowStreamFrame = 0;
    let workflowStreamTicker = 0;
    let workflowStreamRenderedLength = 0;
    let workflowStreamProgressCharacters = 0;
    let workflowStreamBound = false;
    let workflowStreamDom = null;

    function workflowStreamElements() {
        if (workflowStreamDom && workflowStreamDom.streamStage?.isConnected) return workflowStreamDom;
        workflowStreamDom = {
            streamStage: document.querySelector('[data-workflow-stream-stage]'),
            streamTitle: document.querySelector('[data-workflow-stream-title]'),
            streamViewport: document.querySelector('[data-workflow-stream-viewport]'),
            streamEmpty: document.querySelector('[data-workflow-stream-empty]'),
            streamManuscript: document.querySelector('[data-workflow-stream-manuscript]'),
            streamText: document.querySelector('[data-workflow-stream-text]'),
            streamStatus: document.querySelector('[data-workflow-stream-status]'),
            streamCharacters: document.querySelector('[data-workflow-stream-characters]'),
            streamRate: document.querySelector('[data-workflow-stream-rate]'),
            streamElapsed: document.querySelector('[data-workflow-stream-elapsed]'),
            streamPosition: document.querySelector('[data-workflow-stream-position]'),
            streamModel: document.querySelector('[data-workflow-stream-model]'),
            streamUsage: document.querySelector('[data-workflow-stream-usage]'),
            streamFollow: document.querySelector('[data-workflow-stream-follow]'),
            streamFollowLabel: document.querySelector('[data-workflow-stream-follow-label]'),
            streamMinimize: document.querySelector('[data-workflow-stream-minimize]')
        };
        return workflowStreamDom;
    }

    function workflowStreamFormatElapsed(milliseconds) {
        const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }

    function workflowStreamPhaseLabel(state) {
        if (state.phase === 'streaming') return '文字生成中';
        if (state.phase === 'saving') return '正在安全保存';
        if (state.phase === 'complete') return '本段生成完成';
        if (state.phase === 'failed') return '生成意外中断';
        return state.status || '等待模型落笔';
    }

    function workflowStreamScheduleRender() {
        if (workflowStreamFrame) return;
        const schedule = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : (callback) => window.setTimeout(callback, 16);
        workflowStreamFrame = schedule(() => {
            workflowStreamFrame = 0;
            renderWorkflowStreamStage();
        });
    }

    function workflowStreamScrollToLatest(elements) {
        const state = workflowState.streamPreview;
        if (!state.follow || !elements.streamViewport) return;
        elements.streamViewport.scrollTop = elements.streamViewport.scrollHeight;
    }

    function renderWorkflowStreamStage() {
        const elements = workflowStreamElements();
        const state = workflowState.streamPreview;
        if (!elements.streamStage || !state) return;
        const selected = selectedWorkflowRun();
        elements.streamStage.hidden = !state.visible || !!(state.runId && (!selected || selected.id !== state.runId));
        elements.streamStage.dataset.phase = state.phase || 'idle';
        elements.streamStage.classList.toggle('is-collapsed', !!state.collapsed);
        if (elements.streamTitle) elements.streamTitle.textContent = state.title || '正在准备稿纸';
        if (elements.streamStatus) elements.streamStatus.textContent = workflowStreamPhaseLabel(state);
        if (elements.streamCharacters) elements.streamCharacters.textContent = Number(state.text.length || 0).toLocaleString('zh-CN');
        const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
        if (elements.streamElapsed) elements.streamElapsed.textContent = workflowStreamFormatElapsed(elapsed);
        const writingElapsed = state.firstTokenAt ? Math.max(1, (Date.now() - state.firstTokenAt) / 1000) : 0;
        const rate = writingElapsed ? Math.round(state.text.length / writingElapsed) : 0;
        if (elements.streamRate) elements.streamRate.textContent = rate ? `${rate.toLocaleString('zh-CN')} 字/秒` : '等待首字';
        if (elements.streamPosition) {
            const position = state.total ? `第 ${state.current || 1}/${state.total} 段` : '当前段落';
            const cumulative = state.cumulativeCharacters ? ` · 全程累计 ${Number(state.cumulativeCharacters + state.text.length).toLocaleString('zh-CN')} 字` : '';
            elements.streamPosition.textContent = `${position}${cumulative}`;
        }
        if (elements.streamModel) elements.streamModel.textContent = state.model ? `由 ${state.model} 实时书写` : '';
        if (elements.streamUsage) {
            const label = state.usageHint && state.usageHint.label ? String(state.usageHint.label) : '';
            const safe = label && !/^输入\s*0\s*tokens/.test(label) ? label : '待估算';
            elements.streamUsage.textContent = safe;
            elements.streamUsage.dataset.usageSource = (state.usageHint && state.usageHint.source) || '';
        }
        if (elements.streamFollow) {
            elements.streamFollow.classList.toggle('is-active', !!state.follow);
            elements.streamFollow.setAttribute('aria-pressed', state.follow ? 'true' : 'false');
        }
        if (elements.streamFollowLabel) elements.streamFollowLabel.textContent = state.follow ? '自动跟随' : '继续跟随';
        if (elements.streamMinimize) {
            elements.streamMinimize.textContent = state.collapsed ? '展开预览' : '收起预览';
            elements.streamMinimize.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
        }
        const hasText = !!state.text;
        if (elements.streamEmpty) elements.streamEmpty.hidden = hasText;
        if (elements.streamManuscript) elements.streamManuscript.hidden = !hasText;
        if (elements.streamText) {
            if (workflowStreamRenderedLength > state.text.length) {
                elements.streamText.textContent = '';
                workflowStreamRenderedLength = 0;
            }
            if (workflowStreamRenderedLength < state.text.length) {
                const ink = document.createElement('span');
                ink.className = 'desktop-workflow-stream-ink';
                ink.textContent = state.text.slice(workflowStreamRenderedLength);
                elements.streamText.appendChild(ink);
                workflowStreamRenderedLength = state.text.length;
                if (elements.streamText.childNodes.length > 160) {
                    const nodes = Array.from(elements.streamText.childNodes);
                    const animatedTail = nodes.slice(-40);
                    const settledText = nodes.slice(0, -40).map((node) => node.textContent || '').join('');
                    elements.streamText.replaceChildren(document.createTextNode(settledText), ...animatedTail);
                }
            }
        }
        if (state.phase === 'streaming'
            && typeof window.setWorkflowGenerationProgress === 'function'
            && (!workflowStreamProgressCharacters || state.text.length - workflowStreamProgressCharacters >= 50)) {
            workflowStreamProgressCharacters = state.text.length;
            window.setWorkflowGenerationProgress({
                phase: '接收内容',
                title: state.title,
                current: state.current,
                total: state.total,
                characters: state.text.length,
                cumulativeCharacters: state.cumulativeCharacters + state.text.length
            });
        }
        workflowStreamScrollToLatest(elements);
    }

    function beginWorkflowStreamStage(options = {}) {
        const state = workflowState.streamPreview;
        workflowStreamRenderedLength = 0;
        workflowStreamProgressCharacters = 0;
        const elements = workflowStreamElements();
        if (elements.streamText) elements.streamText.textContent = '';
        state.visible = true;
        state.phase = 'waiting';
        state.runId = String(options.runId || '');
        state.title = String(options.title || '正在生成正文');
        state.status = '等待模型落笔';
        state.text = '';
        state.current = Number(options.current || 1);
        state.total = Number(options.total || 1);
        state.cumulativeCharacters = Number(options.cumulativeCharacters || 0);
        state.startedAt = Date.now();
        state.firstTokenAt = 0;
        state.lastTokenAt = 0;
        state.follow = true;
        state.collapsed = false;
        state.model = String(options.model || '');
        state.usageHint = options.usageHint || state.usageHint || null;
        if (workflowStreamTicker) window.clearInterval(workflowStreamTicker);
        workflowStreamTicker = window.setInterval(() => {
            if (!workflowState.streamPreview.visible || ['complete', 'failed'].includes(workflowState.streamPreview.phase)) {
                window.clearInterval(workflowStreamTicker);
                workflowStreamTicker = 0;
                return;
            }
            workflowStreamScheduleRender();
        }, 1000);
        renderWorkflowStreamStage();
    }

    function appendWorkflowStreamText(token) {
        if (!token || !workflowState.streamPreview.visible) return;
        const state = workflowState.streamPreview;
        const now = Date.now();
        state.phase = 'streaming';
        state.status = '文字正从模型实时抵达';
        state.firstTokenAt = state.firstTokenAt || now;
        state.lastTokenAt = now;
        state.text += String(token);
        if (workflowState.reasoning && workflowState.reasoning.phase === 'answer' && workflowState.reasoning.visible) {
            workflowState.reasoning.visible = false;
            renderWorkflowReasoningBubble();
        }
        workflowStreamScheduleRender();
    }

    function markWorkflowStreamSaving(message = '正文已接收，正在安全保存') {
        const state = workflowState.streamPreview;
        if (!state.visible) return;
        state.phase = 'saving';
        state.status = message;
        renderWorkflowStreamStage();
    }

    function finishWorkflowStreamStage(ok, message) {
        const state = workflowState.streamPreview;
        if (!state.visible) return;
        state.phase = ok ? 'complete' : 'failed';
        state.status = message || (ok ? '本段正文已经生成并保存' : '生成中断，已保留当前预览');
        if (workflowStreamTicker) window.clearInterval(workflowStreamTicker);
        workflowStreamTicker = 0;
        renderWorkflowStreamStage();
    }

    function hideWorkflowStreamStage() {
        const state = workflowState.streamPreview;
        state.visible = false;
        state.phase = 'idle';
        state.text = '';
        workflowStreamRenderedLength = 0;
        if (workflowStreamTicker) window.clearInterval(workflowStreamTicker);
        workflowStreamTicker = 0;
        renderWorkflowStreamStage();
    }

    window.bindWorkflowStreamStage = function bindWorkflowStreamStage() {
        if (workflowStreamBound) return;
        const elements = workflowStreamElements();
        if (!elements.streamStage) return;
        workflowStreamBound = true;
        elements.streamFollow?.addEventListener('click', () => {
            workflowState.streamPreview.follow = !workflowState.streamPreview.follow;
            renderWorkflowStreamStage();
        });
        elements.streamMinimize?.addEventListener('click', () => {
            workflowState.streamPreview.collapsed = !workflowState.streamPreview.collapsed;
            renderWorkflowStreamStage();
        });
        elements.streamViewport?.addEventListener('wheel', (event) => {
            if (event.deltaY < 0 && workflowState.streamPreview.follow) {
                workflowState.streamPreview.follow = false;
                renderWorkflowStreamStage();
            }
        }, { passive: true });
        elements.streamViewport?.addEventListener('keydown', (event) => {
            if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) && workflowState.streamPreview.follow) {
                workflowState.streamPreview.follow = false;
                renderWorkflowStreamStage();
            }
        });
    };

    function setWorkflowStreamUsageHint(usageHint) {
        const state = workflowState.streamPreview;
        if (!state) return;
        state.usageHint = usageHint || null;
        if (state.visible) workflowStreamScheduleRender();
    }

    window.beginWorkflowStreamStage = beginWorkflowStreamStage;
    window.appendWorkflowStreamText = appendWorkflowStreamText;
    window.markWorkflowStreamSaving = markWorkflowStreamSaving;
    window.finishWorkflowStreamStage = finishWorkflowStreamStage;
    window.hideWorkflowStreamStage = hideWorkflowStreamStage;
    window.renderWorkflowStreamStage = renderWorkflowStreamStage;
    window.setWorkflowStreamUsageHint = setWorkflowStreamUsageHint;
