    const COMPENDIUM_REFERENCE_LIMIT = 5;
    const COMPENDIUM_REFERENCE_BODY_LIMIT = 1800;

    function compendiumReferenceSnapshot(entry) {
        return {
            id: entry.id,
            type: entry.type,
            title: entry.title || '',
            summary: entry.summary || '',
            tags: Array.isArray(entry.tags) ? entry.tags : [],
            aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
            characterProfile: entry.type === 'character' ? (entry.characterProfile || {}) : undefined,
            body: String(entry.body || '').slice(0, COMPENDIUM_REFERENCE_BODY_LIMIT)
        };
    }

    function renderCompendiumReferencePicker(container, count, selectedIds = [], options = {}) {
        if (!container) return;
        const selected = new Set(selectedIds);
        const entries = (compendiumState.entries || []).filter((entry) => entry.id !== options.excludeId);
        container.replaceChildren();
        if (!entries.length) {
            const empty = document.createElement('p');
            empty.className = 'desktop-compendium-reference-empty';
            empty.textContent = '当前项目还没有可选的其他资料卡。';
            container.append(empty);
        } else {
            entries.forEach((entry) => {
                const label = document.createElement('label');
                const input = document.createElement('input');
                const text = document.createElement('span');
                input.type = 'checkbox'; input.value = entry.id; input.checked = selected.has(entry.id); input.dataset.compendiumReference = '';
                text.textContent = `${entry.title || '未命名资料'} · ${entry.type || '设定'}`;
                label.append(input, text);
                container.append(label);
            });
        }
        const update = () => {
            const checked = Array.from(container.querySelectorAll('[data-compendium-reference]:checked'));
            if (checked.length > COMPENDIUM_REFERENCE_LIMIT) {
                checked.at(-1).checked = false;
                return update();
            }
            if (count) count.textContent = checked.length ? `已选 ${checked.length}/${COMPENDIUM_REFERENCE_LIMIT} 张` : '未添加';
        };
        container.querySelectorAll('[data-compendium-reference]').forEach((input) => input.addEventListener('change', update));
        update();
    }

    function selectedCompendiumReferenceCards(container) {
        const ids = new Set(Array.from(container ? container.querySelectorAll('[data-compendium-reference]:checked') : []).map((input) => input.value));
        return (compendiumState.entries || []).filter((entry) => ids.has(entry.id)).slice(0, COMPENDIUM_REFERENCE_LIMIT).map(compendiumReferenceSnapshot);
    }

    function compendiumReferencesPromptBlock(cards) {
        return cards && cards.length ? `\n\n参考资料卡（仅作本次生成依据，不得改写或当作新事实）：\n${JSON.stringify(cards)}` : '';
    }
