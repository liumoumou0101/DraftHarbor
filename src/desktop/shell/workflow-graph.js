    function cloneWorkflowGraphValue(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function workflowGraphEdgeNode(edge, side) {
        return edge && edge[side] && edge[side].nodeId ? edge[side].nodeId : edge && edge[`${side}NodeId`];
    }

    function workflowGraphValidation(definition) {
        const catalog = window.DraftHarborWorkflowBuiltinCatalog;
        if (!catalog) return { ok: false, errors: ['工作流能力目录未加载'] };
        if (!window.__draftHarborWorkflowRegistry) window.__draftHarborWorkflowRegistry = catalog.createBuiltinWorkflowRegistry();
        return window.__draftHarborWorkflowRegistry.validateWorkflowDefinition(definition);
    }

    function workflowGraphValidationMessage(message) {
        const text = String(message || '');
        let match = /^edge (.+) artifact types are incompatible$/.exec(text);
        if (match) return `连线 ${match[1]} 的产物类型不兼容`;
        match = /^edge (.+) (input|output) port not found$/.exec(text);
        if (match) return `连线 ${match[1]} 的${match[2] === 'input' ? '输入' : '输出'}端口不存在`;
        match = /(acyclic|contains a cycle)/i.exec(text);
        if (match) return '工作流不能包含循环连线';
        return text;
    }

    function workflowGraphRegistry() {
        workflowGraphValidation({ id: 'probe', title: 'probe', nodes: [{ id: 'probe', capabilityId: 'writer.snapshot' }] });
        return window.__draftHarborWorkflowRegistry;
    }

    function workflowGraphCapability(node) {
        return workflowGraphRegistry().getCapability(node.capabilityId, node.capabilityVersion || 1);
    }

    async function loadWorkflowGraphTemplates() {
        try {
            const response = await fetch('/api/workflows/v2/templates', { cache: 'no-store' });
            const result = await response.json().catch(() => ({}));
            workflowState.graphTemplates = response.ok && result.ok ? result.templates || [] : [];
        } catch (_) { workflowState.graphTemplates = []; }
    }

    async function startWorkflowGraphTemplate(run, template) {
        const elements = workflowElements(); const base = template.executionCompatibility.baseTemplateId;
        const payload = { projectId: currentProjectId(), templateId: template.id, templateVersion: template.version, constraints: (run.settings && run.settings.constraints) || workflowLockConstraints(elements), fineOutlineEnabled: run.settings?.fineOutlineEnabled !== false };
        const activeScene = (nativeEditorState.snapshot?.scenes || []).find((scene) => scene.id === nativeEditorState.activeSceneId) || (nativeEditorState.snapshot?.scenes || [])[0];
        payload.sceneId = activeScene && activeScene.id; payload.chapterId = activeScene && activeScene.chapterId;
        if (base === 'continuation-guided') {
            payload.scope = elements.sourceScope?.value || 'chapter'; payload.brief = run.templateId === base ? run.settings?.brief : elements.brief?.value || '';
        } else if (base === 'creation-guided') {
            const briefArtifact = (run.artifacts || []).filter((artifact) => artifact.nodeId === 'brief').slice(-1)[0];
            payload.brief = briefArtifact?.content || { workingTitle: elements.creationTitle?.value || '未命名新作', premise: elements.creationPremise?.value || '从自定义模板开始创作。', genre: elements.creationGenre?.value || '', targetLength: Number(elements.creationTargetLength?.value) || 0, themes: String(elements.creationThemes?.value || '').split(/[，,]/).map((item) => item.trim()).filter(Boolean), tone: elements.creationTone?.value || '', pointOfView: elements.creationPov?.value || '', setting: elements.creationSetting?.value || '' };
        } else {
            payload.scope = elements.rewriteScope?.value || 'chapter'; payload.brief = run.templateId === base ? run.settings?.brief : { instruction: elements.rewriteInstruction?.value || '按模板重写当前内容。', targetStyle: elements.rewriteStyle?.value || '', targetTone: elements.rewriteTone?.value || '', pointOfView: elements.rewritePov?.value || '', targetLengthRatio: Number(elements.rewriteRatio?.value) || 1 };
        }
        const response = await fetch('/api/workflows/v2/start-template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json().catch(() => ({})); if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.selectedId = result.runId; resetWorkflowGraphDraft(); await loadWorkflowRuns(); workflowState.viewMode = 'graph'; renderWorkflow(); setWorkflowStatus(`已从模板“${template.title}”创建真实运行。`, 'ok');
    }

    async function restartWorkflowGraphNode(run, nodeId) {
        const response = await fetch('/api/workflows/v2/restart-node', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: currentProjectId(), runId: run.id, nodeId, reason: '用户从图视图请求重新运行' }) });
        const result = await response.json().catch(() => ({})); if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        workflowState.runs = workflowState.runs.map((item) => item.id === run.id ? result.run : item); await loadWorkflowEvents(); renderWorkflow(); setWorkflowStatus(`节点“${nodeId}”及其下游已重置，旧产物保留为过期历史。`, 'ok');
    }

    function resetWorkflowGraphDraft() {
        workflowState.graphEditing = false;
        workflowState.graphDraftRunId = '';
        workflowState.graphDraft = null;
        workflowState.graphSelectedNodeId = '';
        workflowState.graphTemplateId = '';
        workflowState.graphTemplateVersion = 0;
        workflowState.graphLoadedTemplate = null;
        workflowState.graphPendingConnection = null;
    }

    function beginWorkflowGraphEdit(run) {
        if (!workflowState.graphDraft || workflowState.graphDraftRunId !== run.id) {
            workflowState.graphDraft = cloneWorkflowGraphValue(run.definition);
            workflowState.graphDraftRunId = run.id;
            workflowState.graphSelectedNodeId = (workflowState.graphDraft.nodes[0] || {}).id || '';
        }
        workflowState.graphEditing = true;
        renderWorkflow();
    }

    function renderWorkflowGraphInspector(container, definition, run) {
        const selected = definition.nodes.find((node) => node.id === workflowState.graphSelectedNodeId) || definition.nodes[0];
        if (selected) workflowState.graphSelectedNodeId = selected.id;
        const panel = document.createElement('aside');
        panel.className = 'desktop-workflow-graph-inspector';
        const title = document.createElement('strong');
        title.textContent = selected ? '节点配置' : '画布配置';
        panel.appendChild(title);

        const libraryTitle = document.createElement('strong'); libraryTitle.textContent = '节点库';
        const library = document.createElement('div'); library.className = 'desktop-workflow-graph-node-library';
        const capabilitySelect = document.createElement('select');
        workflowGraphRegistry().listCapabilities().forEach((capability) => {
            const option = document.createElement('option'); option.value = `${capability.id}@${capability.version}`; option.textContent = `${capability.category} · ${capability.title}`; capabilitySelect.appendChild(option);
        });
        const addNode = document.createElement('button'); addNode.type = 'button'; addNode.textContent = '添加节点';
        addNode.addEventListener('click', () => {
            const [capabilityId, version] = capabilitySelect.value.split('@'); const capability = workflowGraphRegistry().getCapability(capabilityId, Number(version));
            const base = capabilityId.split('.').slice(-1)[0] || 'node'; let id = base; let suffix = 1;
            while (definition.nodes.some((node) => node.id === id)) id = `${base}-${++suffix}`;
            const maxX = Math.max(0, ...definition.nodes.map((node) => Number(node.position?.x || 0)));
            definition.nodes.push({ id, capabilityId, capabilityVersion: Number(version), title: capability.title, description: '', config: cloneWorkflowGraphValue(capability.configDefaults || {}), position: { x: maxX + 240, y: 150 }, disabled: false });
            workflowState.graphSelectedNodeId = id; renderWorkflow();
        });
        library.append(capabilitySelect, addNode); panel.append(libraryTitle, library);

        if (selected) {
            const field = (label, value, type, onChange) => {
                const wrapper = document.createElement('label');
                const caption = document.createElement('span'); caption.textContent = label;
                const input = document.createElement('input'); input.type = type || 'text'; input.value = value;
                input.addEventListener('change', () => onChange(input.value));
                wrapper.append(caption, input); panel.appendChild(wrapper);
            };
            field('标题', selected.title || '', 'text', (value) => { selected.title = value.trim(); renderWorkflow(); });
            field('横坐标', selected.position?.x || 0, 'number', (value) => { selected.position = { ...(selected.position || {}), x: Number(value) || 0 }; renderWorkflow(); });
            field('纵坐标', selected.position?.y || 0, 'number', (value) => { selected.position = { ...(selected.position || {}), y: Number(value) || 0 }; renderWorkflow(); });
            const capability = document.createElement('p'); capability.textContent = `${selected.capabilityId || '未知能力'}@${selected.capabilityVersion || 1}`; panel.appendChild(capability);
            const disabled = document.createElement('label');
            disabled.className = 'desktop-workflow-graph-check';
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.disabled === true;
            checkbox.addEventListener('change', () => { selected.disabled = checkbox.checked; renderWorkflow(); });
            const disabledText = document.createElement('span'); disabledText.textContent = '禁用此节点';
            disabled.append(checkbox, disabledText); panel.appendChild(disabled);
            const actions = document.createElement('div'); actions.className = 'desktop-workflow-graph-inspector-actions';
            const duplicate = document.createElement('button'); duplicate.type = 'button'; duplicate.textContent = '复制节点';
            duplicate.addEventListener('click', () => {
                let suffix = 1; let nextId = `${selected.id}-copy`;
                while (definition.nodes.some((node) => node.id === nextId)) nextId = `${selected.id}-copy-${++suffix}`;
                const copy = cloneWorkflowGraphValue(selected); copy.id = nextId; copy.title = `${selected.title || selected.id} 副本`;
                copy.position = { x: Number(selected.position?.x || 0) + 40, y: Number(selected.position?.y || 0) + 150 };
                definition.nodes.push(copy); workflowState.graphSelectedNodeId = copy.id; renderWorkflow();
            });
            const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除节点'; remove.className = 'is-danger';
            remove.addEventListener('click', () => {
                definition.nodes = definition.nodes.filter((node) => node.id !== selected.id);
                definition.edges = definition.edges.filter((edge) => workflowGraphEdgeNode(edge, 'from') !== selected.id && workflowGraphEdgeNode(edge, 'to') !== selected.id);
                workflowState.graphSelectedNodeId = (definition.nodes[0] || {}).id || ''; renderWorkflow();
            });
            actions.append(duplicate, remove); panel.appendChild(actions);
        }

        const edgeTitle = document.createElement('strong'); edgeTitle.textContent = '连线'; panel.appendChild(edgeTitle);
        const edgeList = document.createElement('div'); edgeList.className = 'desktop-workflow-graph-edge-list';
        definition.edges.forEach((edge) => {
            const row = document.createElement('div');
            const label = document.createElement('span'); label.textContent = `${workflowGraphEdgeNode(edge, 'from')} → ${workflowGraphEdgeNode(edge, 'to')}`;
            const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = '删除连线';
            remove.addEventListener('click', () => { definition.edges = definition.edges.filter((item) => item !== edge); renderWorkflow(); });
            row.append(label, remove); edgeList.appendChild(row);
        });
        panel.appendChild(edgeList);
        if (definition.nodes.length > 1) {
            const add = document.createElement('div'); add.className = 'desktop-workflow-graph-edge-add';
            const from = document.createElement('select'); const fromPort = document.createElement('select'); const to = document.createElement('select'); const toPort = document.createElement('select');
            definition.nodes.forEach((node) => {
                const a = document.createElement('option'); a.value = node.id; a.textContent = node.title || node.id; from.appendChild(a);
                const b = document.createElement('option'); b.value = node.id; b.textContent = node.title || node.id; to.appendChild(b);
            });
            to.selectedIndex = Math.min(1, to.options.length - 1);
            const fillPorts = (nodeSelect, portSelect, direction, preferred) => {
                portSelect.replaceChildren(); const node = definition.nodes.find((item) => item.id === nodeSelect.value); const capability = node && workflowGraphCapability(node);
                (capability ? (direction === 'output' ? capability.outputPorts : capability.inputPorts) : []).forEach((port) => { const option = document.createElement('option'); option.value = port.id; option.textContent = `${port.label} · ${port.artifactTypes.map((type) => `${type.id}@${type.version}`).join(' / ')}`; portSelect.appendChild(option); });
                if (preferred && Array.from(portSelect.options).some((option) => option.value === preferred)) portSelect.value = preferred;
            };
            const refreshFrom = () => fillPorts(from, fromPort, 'output', 'next'); const refreshTo = () => fillPorts(to, toPort, 'input', 'previous');
            from.addEventListener('change', refreshFrom); to.addEventListener('change', refreshTo); refreshFrom(); refreshTo();
            const button = document.createElement('button'); button.type = 'button'; button.textContent = '添加连线';
            button.addEventListener('click', () => {
                definition.edges.push({ id: `edge-${Date.now()}`, from: { nodeId: from.value, portId: fromPort.value }, to: { nodeId: to.value, portId: toPort.value } });
                renderWorkflow();
            });
            add.append(from, fromPort, to, toPort, button); panel.appendChild(add);
        }
        const validation = workflowGraphValidation(definition);
        const result = document.createElement('div'); result.className = `desktop-workflow-graph-validation ${validation.ok ? 'is-valid' : 'is-invalid'}`;
        result.dataset.workflowGraphValidation = validation.ok ? 'valid' : 'invalid';
        result.setAttribute('role', validation.ok ? 'status' : 'alert');
        result.textContent = validation.ok ? '结构校验通过' : validation.errors.map(workflowGraphValidationMessage).join('\n');
        panel.appendChild(result);
        container.appendChild(panel);
    }

    function renderWorkflowGraph(container, run) {
        container.replaceChildren();
        if (workflowState.graphDraftRunId && (!run || workflowState.graphDraftRunId !== run.id)) resetWorkflowGraphDraft();
        const definition = workflowState.graphDraft && workflowState.graphDraftRunId === run?.id ? workflowState.graphDraft : run && run.definition;
        const nodes = definition && Array.isArray(definition.nodes) ? definition.nodes : [];
        const edges = definition && Array.isArray(definition.edges) ? definition.edges : [];
        if (!nodes.length) {
            const empty = document.createElement('div'); empty.className = 'desktop-workflow-graph-empty';
            empty.textContent = run ? '此运行没有可显示的 Definition 节点。' : '选择一个运行后查看工作流图。'; container.appendChild(empty); return;
        }

        const editing = workflowState.graphEditing;
        const hasDraft = workflowState.graphDraftRunId === run.id && !!workflowState.graphDraft;
        if (!editing && !nodes.some((node) => node.id === workflowState.graphSelectedNodeId)) workflowState.graphSelectedNodeId = run.activeNodeId || nodes[0].id;
        const statusLabels = { completed: '已完成', failed: '失败', cancelled: '已取消', in_progress: '生成中', waiting_user: '等待审批', ready: '准备执行', pending: '待处理', skipped: '已跳过' };
        const stepMap = new Map((run.steps || []).map((item) => [item.id, item]));
        const nodeWidth = 204; const nodeHeight = 126; const padding = 28; const positions = new Map();
        nodes.forEach((node, index) => { const source = node.position || {}; positions.set(node.id, { x: padding + (Number.isFinite(Number(source.x)) ? Number(source.x) : index * 240), y: padding + (Number.isFinite(Number(source.y)) ? Number(source.y) : 0) }); });
        const width = Math.max(620, ...Array.from(positions.values()).map((position) => position.x + nodeWidth + padding));
        const height = Math.max(260, ...Array.from(positions.values()).map((position) => position.y + nodeHeight + padding));

        const header = document.createElement('header'); const heading = document.createElement('div');
        const kicker = document.createElement('p'); kicker.className = 'desktop-section-kicker'; kicker.textContent = editing ? '模板编辑草稿' : hasDraft ? '未保存模板草稿' : 'Definition 快照';
        const title = document.createElement('strong'); title.textContent = definition.title || run.title || '工作流图'; heading.append(kicker, title);
        const actions = document.createElement('div'); actions.className = 'desktop-workflow-graph-header-actions';
        const note = document.createElement('span'); note.textContent = `${editing ? '编辑中' : hasDraft ? '草稿预览' : '只读'} · ${nodes.length} 个节点 · ${edges.length} 条连线`; actions.appendChild(note);
        if (!editing && !hasDraft) {
            const selectedNode = nodes.find((node) => node.id === workflowState.graphSelectedNodeId);
            const selectedStep = (run.steps || []).find((step) => step.id === workflowState.graphSelectedNodeId);
            const isActive = selectedStep && selectedStep.id === run.activeNodeId;
            const canGenerate = isActive && selectedStep.status === 'ready' && !['writer.snapshot', 'creation.brief', 'transfer.apply', 'transfer.update'].includes(selectedNode?.capabilityId);
            const single = document.createElement('button'); single.type = 'button'; single.dataset.workflowGraphRunNode = ''; single.textContent = '运行单节点'; single.disabled = !canGenerate || workflowState.generating; single.title = canGenerate ? '仅运行当前活动节点，生成结果后停下' : '只能运行当前处于准备状态的活动节点'; single.addEventListener('click', () => generateGuidedWorkflowNode().catch((error) => setWorkflowStatus(`节点运行失败：${error.message || error}`, 'error')));
            const checkpoint = document.createElement('button'); checkpoint.type = 'button'; checkpoint.dataset.workflowGraphRunCheckpoint = ''; checkpoint.textContent = '运行到确认点'; checkpoint.disabled = !canGenerate || workflowState.generating; checkpoint.title = '当前半自动执行器会在下一个人工审批结果处停下'; checkpoint.addEventListener('click', () => generateGuidedWorkflowNode().catch((error) => setWorkflowStatus(`运行失败：${error.message || error}`, 'error')));
            const restart = document.createElement('button'); restart.type = 'button'; restart.dataset.workflowGraphRestartNode = ''; restart.textContent = '重跑此节点及下游';
            restart.disabled = !selectedNode || ['writer.snapshot', 'creation.brief', 'transfer.apply', 'transfer.update'].includes(selectedNode.capabilityId) || workflowState.generating;
            restart.title = restart.disabled ? '来源、初始 Brief 和转交节点不能从这里重跑' : '保留旧产物并将此节点及全部下游标记为待重新生成'; restart.addEventListener('click', () => restartWorkflowGraphNode(run, selectedNode.id).catch((error) => setWorkflowStatus(`重跑失败：${error.message || error}`, 'error')));
            actions.append(single, checkpoint, restart);
        }
        if (!editing && workflowState.graphTemplates.length) {
            const templates = document.createElement('select'); templates.dataset.workflowGraphTemplateSelect = '';
            workflowState.graphTemplates.forEach((template) => {
                (template.availableVersions || [template.version]).forEach((version) => {
                    const option = document.createElement('option'); option.value = `${template.id}::${version}`; option.textContent = `${template.title} · v${version}${Number(version) === Number(template.version) ? '（最新）' : ''}`; templates.appendChild(option);
                });
            });
            if (workflowState.graphTemplateId) templates.value = `${workflowState.graphTemplateId}::${workflowState.graphTemplateVersion || ''}`;
            const load = document.createElement('button'); load.type = 'button'; load.dataset.workflowGraphLoadTemplate = ''; load.textContent = '载入模板草稿';
            load.addEventListener('click', async () => {
                const [templateId, version] = templates.value.split('::');
                load.disabled = true;
                try {
                    const response = await fetch(`/api/workflows/v2/template?templateId=${encodeURIComponent(templateId)}&version=${encodeURIComponent(version)}`, { cache: 'no-store' });
                    const result = await response.json().catch(() => ({})); if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
                    const template = result.template;
                    workflowState.graphDraft = cloneWorkflowGraphValue(template.definition); workflowState.graphDraftRunId = run.id; workflowState.graphTemplateId = template.id; workflowState.graphTemplateVersion = template.version; workflowState.graphLoadedTemplate = template; workflowState.graphSelectedNodeId = (template.definition.nodes[0] || {}).id || ''; renderWorkflow();
                } catch (error) { setWorkflowStatus(`模板载入失败：${error.message || error}`, 'error'); load.disabled = false; }
            }); actions.append(templates, load);
        }
        const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.workflowGraphEdit = ''; edit.textContent = editing ? '完成编辑' : hasDraft ? '继续编辑' : '创建编辑草稿';
        edit.addEventListener('click', () => {
            if (!editing) return beginWorkflowGraphEdit(run);
            const validation = workflowGraphValidation(definition);
            if (!validation.ok) return;
            workflowState.graphEditing = false; renderWorkflow();
        }); actions.appendChild(edit);
        if (hasDraft && !editing) {
            const save = document.createElement('button'); save.type = 'button'; save.dataset.workflowGraphSaveTemplate = ''; save.textContent = workflowState.graphTemplateId ? `更新模板 v${workflowState.graphTemplateVersion}` : '保存为模板';
            save.addEventListener('click', async () => {
                const validation = workflowGraphValidation(definition); if (!validation.ok) return;
                const name = workflowState.graphTemplateId ? definition.title : window.prompt('模板名称', definition.title || run.title || '自定义工作流'); if (!name) return;
                save.disabled = true;
                try {
                    const response = await fetch('/api/workflows/v2/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: workflowState.graphTemplateId || undefined, title: name, definition }) });
                    const result = await response.json().catch(() => ({})); if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
                    workflowState.graphTemplateId = result.template.id; workflowState.graphTemplateVersion = result.template.version; workflowState.graphLoadedTemplate = result.template; workflowState.graphDraft = cloneWorkflowGraphValue(result.template.definition);
                    await loadWorkflowGraphTemplates(); renderWorkflow(); setWorkflowStatus(`模板“${result.template.title}”v${result.template.version} 已保存。`, 'ok');
                } catch (error) { setWorkflowStatus(`模板保存失败：${error.message || error}`, 'error'); save.disabled = false; }
            }); actions.appendChild(save);
            const template = workflowState.graphLoadedTemplate || workflowState.graphTemplates.find((item) => item.id === workflowState.graphTemplateId && Number(item.version) === Number(workflowState.graphTemplateVersion));
            if (template) {
                const start = document.createElement('button'); start.type = 'button'; start.dataset.workflowGraphStartTemplate = ''; start.textContent = '从模板启动新运行';
                start.disabled = !template.executionCompatibility?.executable || workflowState.generating;
                start.title = start.disabled ? (template.executionCompatibility?.errors || ['模板与现有执行器不兼容']).join('\n') : '创建新的 v2 运行，当前运行保持不变';
                start.addEventListener('click', async () => { start.disabled = true; try { await startWorkflowGraphTemplate(run, template); } catch (error) { setWorkflowStatus(`模板启动失败：${error.message || error}`, 'error'); start.disabled = false; } }); actions.appendChild(start);
            }
        }
        if (hasDraft) { const discard = document.createElement('button'); discard.type = 'button'; discard.dataset.workflowGraphDiscard = ''; discard.textContent = '丢弃草稿'; discard.addEventListener('click', () => { resetWorkflowGraphDraft(); renderWorkflow(); }); actions.appendChild(discard); }
        header.append(heading, actions);

        const body = document.createElement('div'); body.className = 'desktop-workflow-graph-body'; body.classList.toggle('is-editing', editing);
        const viewport = document.createElement('div'); viewport.className = 'desktop-workflow-graph-viewport';
        const canvas = document.createElement('div'); canvas.className = 'desktop-workflow-graph-canvas'; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
        const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); svg.classList.add('desktop-workflow-graph-edges'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', width); svg.setAttribute('height', height);
        const defs = document.createElementNS(ns, 'defs'); const marker = document.createElementNS(ns, 'marker'); marker.setAttribute('id', 'desktop-workflow-arrow'); marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5'); marker.setAttribute('markerWidth', '7'); marker.setAttribute('markerHeight', '7'); marker.setAttribute('orient', 'auto-start-reverse');
        const arrow = document.createElementNS(ns, 'path'); arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); marker.appendChild(arrow); defs.appendChild(marker); svg.appendChild(defs);
        edges.forEach((edge) => { const fromId = workflowGraphEdgeNode(edge, 'from'); const toId = workflowGraphEdgeNode(edge, 'to'); const from = positions.get(fromId); const to = positions.get(toId); if (!from || !to) return; const path = document.createElementNS(ns, 'path'); const sx = from.x + nodeWidth; const sy = from.y + nodeHeight / 2; const ex = to.x; const ey = to.y + nodeHeight / 2; const curve = Math.max(40, Math.abs(ex - sx) / 2); path.setAttribute('d', `M ${sx} ${sy} C ${sx + curve} ${sy}, ${ex - curve} ${ey}, ${ex} ${ey}`); path.setAttribute('marker-end', 'url(#desktop-workflow-arrow)'); path.dataset.workflowGraphEdge = edge.id || `${fromId}-${toId}`; svg.appendChild(path); });
        canvas.appendChild(svg);

        nodes.forEach((node) => {
            const step = stepMap.get(node.id) || {}; const position = positions.get(node.id); const nodeArtifacts = (run.artifacts || []).filter((artifact) => artifact.nodeId === node.id); const artifactCount = nodeArtifacts.length; const staleCount = nodeArtifacts.filter((artifact) => artifact.effectiveFreshness === 'stale').length;
            const card = document.createElement('button'); card.type = 'button'; card.className = 'desktop-workflow-graph-node'; card.dataset.workflowGraphNode = node.id; card.dataset.status = step.status || 'pending'; card.dataset.hasArtifacts = artifactCount ? 'true' : 'false'; card.classList.toggle('is-active', editing ? node.id === workflowState.graphSelectedNodeId : node.id === run.activeStepId); card.classList.toggle('is-disabled', node.disabled === true); card.style.left = `${position.x}px`; card.style.top = `${position.y}px`;
            card.classList.toggle('is-selected', !editing && node.id === workflowState.graphSelectedNodeId); card.classList.toggle('has-stale-artifacts', staleCount > 0);
            const nodeHeader = document.createElement('span'); const nodeTitle = document.createElement('strong'); nodeTitle.textContent = node.title || node.id; const status = document.createElement('em'); status.textContent = node.disabled ? '已禁用' : statusLabels[step.status] || step.status || '待处理'; nodeHeader.append(nodeTitle, status);
            const capability = document.createElement('span'); capability.className = 'desktop-workflow-graph-capability'; capability.textContent = node.capabilityId || node.kind || 'workflow.node'; const meta = document.createElement('span'); meta.className = 'desktop-workflow-graph-meta'; meta.textContent = artifactCount ? `${artifactCount} 个产物${staleCount ? ` · ${staleCount} 个过期` : ''}` : '暂无产物'; card.append(nodeHeader, capability, meta);
            if (editing) {
                const capabilityDefinition = workflowGraphCapability(node); const ports = document.createElement('span'); ports.className = 'desktop-workflow-graph-node-ports'; ports.addEventListener('pointerdown', (event) => event.stopPropagation());
                const inputs = document.createElement('i'); const outputs = document.createElement('i');
                (capabilityDefinition?.inputPorts || []).forEach((port) => {
                    const button = document.createElement('button'); button.type = 'button'; button.dataset.workflowGraphInputPort = `${node.id}:${port.id}`; button.textContent = `◀ ${port.id}`; button.title = `${port.label} · ${port.artifactTypes.map((type) => `${type.id}@${type.version}`).join(' / ')}`;
                    button.addEventListener('click', (event) => { event.stopPropagation(); const pending = workflowState.graphPendingConnection; if (!pending) return; definition.edges.push({ id: `edge-${Date.now()}`, from: pending, to: { nodeId: node.id, portId: port.id } }); workflowState.graphPendingConnection = null; renderWorkflow(); }); inputs.appendChild(button);
                });
                (capabilityDefinition?.outputPorts || []).forEach((port) => {
                    const button = document.createElement('button'); button.type = 'button'; button.dataset.workflowGraphOutputPort = `${node.id}:${port.id}`; button.textContent = `${port.id} ▶`; button.title = `${port.label} · ${port.artifactTypes.map((type) => `${type.id}@${type.version}`).join(' / ')}`;
                    const pending = workflowState.graphPendingConnection; button.classList.toggle('is-pending', !!pending && pending.nodeId === node.id && pending.portId === port.id);
                    button.addEventListener('click', (event) => { event.stopPropagation(); workflowState.graphPendingConnection = { nodeId: node.id, portId: port.id }; renderWorkflow(); }); outputs.appendChild(button);
                });
                ports.append(inputs, outputs); card.appendChild(ports);
            }
            if (editing) {
                card.addEventListener('pointerdown', (event) => { if (event.button !== 0) return; const startX = event.clientX; const startY = event.clientY; const origin = { ...(node.position || { x: 0, y: 0 }) }; card.setPointerCapture(event.pointerId); card.dataset.dragged = 'false'; const move = (next) => { const dx = next.clientX - startX; const dy = next.clientY - startY; if (Math.abs(dx) + Math.abs(dy) > 4) card.dataset.dragged = 'true'; node.position = { x: Math.round(Number(origin.x || 0) + dx), y: Math.round(Number(origin.y || 0) + dy) }; card.style.left = `${padding + node.position.x}px`; card.style.top = `${padding + node.position.y}px`; }; const up = () => { card.removeEventListener('pointermove', move); card.removeEventListener('pointerup', up); if (card.dataset.dragged === 'true') renderWorkflow(); }; card.addEventListener('pointermove', move); card.addEventListener('pointerup', up); });
            }
            card.addEventListener('click', () => { if (card.dataset.dragged === 'true') return; workflowState.graphSelectedNodeId = node.id; if (editing) { renderWorkflow(); return; } const artifact = (run.artifacts || []).filter((item) => item.nodeId === node.id).slice(-1)[0]; if (artifact) workflowState.selectedArtifactId = artifact.id; renderWorkflow(); });
            canvas.appendChild(card);
        });
        viewport.appendChild(canvas); body.appendChild(viewport); if (editing) renderWorkflowGraphInspector(body, definition, run); container.append(header, body);
    }
