(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DraftHarborAvoidanceRules = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function normalizeRules(values) {
        const seen = new Set();
        return (Array.isArray(values) ? values : []).map((value) => {
            const raw = value && typeof value === 'object' ? value : { text: value };
            return { id: String(raw.id || `avoid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`), text: String(raw.text || '').trim(), reason: String(raw.reason || '').trim(), scope: raw.scope === 'global' ? 'global' : 'project', enabled: raw.enabled !== false };
        }).filter((rule) => rule.text && !seen.has(rule.text) && (seen.add(rule.text) || true)).slice(0, 80);
    }
    function promptInstruction(values) {
        const rules = normalizeRules(values).filter((rule) => rule.enabled);
        if (!rules.length) return '';
        return `避免复用以下表达或写法；保留语义时请换用自然、多样的表达：\n${rules.map((rule) => `- ${rule.text}${rule.reason ? `（${rule.reason}）` : ''}`).join('\n')}`;
    }
    return { normalizeRules, promptInstruction };
});
