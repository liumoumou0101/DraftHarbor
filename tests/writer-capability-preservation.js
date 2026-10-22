const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Frozen pre-desk public control contract, captured from 0120d9087fb046bba95486989e9f7c5ecbeac65f.
// These assertions detect removal/renaming and duplicate stateful inputs. They do
// not prove CSS visibility, handler behavior, keyboard access, or API success.
const baselineControls = {
    "data-reader-source-return": 1,
    "data-reader-source-dismiss": 1,
    "data-reader-source-use": 1,
    "data-native-new-project": 1,
    "data-native-show-bookshelf": 1,
    "data-native-add-scene": 1,
    "data-native-add-chapter": 1,
    "data-native-outline-action=rename": 1,
    "data-native-outline-action=delete": 1,
    "data-native-outline-action=move-up": 1,
    "data-native-outline-action=move-down": 1,
    "data-native-focus-mode": 1,
    "data-native-save-scene": 1,
    "data-native-more-tools": 1,
    "data-native-read-aloud": 1,
    "data-native-stop-reading": 1,
    "data-native-toggle-specials": 1,
    "data-native-format-manuscript": 2,
    "data-native-toggle-typography": 1,
    "data-native-style-guard": 3,
    "data-native-toggle-outline": 1,
    "data-native-toggle-assistant": 1,
    "data-native-assistant-placement": 1,
    "data-native-send-to-workshop": 1,
    "data-native-save-to-compendium": 1,
    "data-native-copy-unsaved-draft": 1,
    "data-native-reload-saved-draft": 1,
    "data-native-editor-font-size": 1,
    "data-native-editor-line-height": 1,
    "data-native-editor-text-width": 1,
    "data-native-editor-paragraph-spacing": 1,
    "data-native-editor-font-family": 1,
    "data-native-editor-word-goal": 1,
    "data-native-special-char=—": 1,
    "data-native-special-char=–": 1,
    "data-native-special-char=…": 1,
    "data-native-special-char=“": 1,
    "data-native-special-char=”": 1,
    "data-native-special-char=‘": 1,
    "data-native-special-char=’": 1,
    "data-native-special-char=«": 1,
    "data-native-special-char=»": 1,
    "data-native-special-char=　": 1,
    "data-native-scene-editor": 1,
    "data-native-context-action=rewrite-selection": 1,
    "data-native-context-action=regenerate-selection": 1,
    "data-native-context-action=send-to-workshop": 1,
    "data-native-context-action=extract-compendium": 1,
    "data-native-context-action=generate-summary": 1,
    "data-native-context-action=view-summary": 1,
    "data-native-context-action=format-manuscript": 1,
    "data-native-context-action=save": 1,
    "data-native-context-action=read-aloud": 1,
    "data-native-reasoning-toggle": 1,
    "data-native-stop-generation": 1,
    "data-native-reasoning": 1,
    "data-native-reasoning-summary": 1,
    "data-native-reasoning-copy": 1,
    "data-native-reasoning-latest": 1,
    "data-native-accept-generation": 1,
    "data-native-retry-generation": 1,
    "data-native-discard-generation": 1,
    "data-native-assistant-group=writing": 1,
    "data-native-assistant-group=context": 1,
    "data-native-assistant-group=document": 1,
    "data-native-panel-tab=generate": 1,
    "data-native-panel-group=writing": 3,
    "data-native-panel-tab=rewrite": 1,
    "data-native-panel-tab=history": 1,
    "data-native-panel-tab=characters": 1,
    "data-native-panel-group=context": 2,
    "data-native-panel-tab=context": 1,
    "data-native-panel-tab=metadata": 1,
    "data-native-panel-group=document": 3,
    "data-native-panel-tab=structure": 1,
    "data-native-panel-tab=search": 1,
    "data-native-gen-task=continue": 1,
    "data-native-gen-task=beat": 1,
    "data-native-gen-task=summary": 1,
    "data-native-open-rewrite": 1,
    "data-native-copilot-suggestion=用具体动作和感官细节续写当前场面，避免直接解释人物情绪。": 1,
    "data-native-copilot-suggestion=提高这一场的紧张感，让人物目标、阻碍和风险更清楚。": 1,
    "data-native-copilot-suggestion=检查当前场景是否贴合前文连续性，并续写一段自然过渡。": 1,
    "data-native-beat-input": 1,
    "data-native-composer-model": 2,
    "data-native-open-writer-settings": 4,
    "data-native-thinking-toggle": 3,
    "data-native-length-hint": 1,
    "data-native-preview-prompt": 2,
    "data-native-generate": 1,
    "data-native-cancel-generation": 1,
    "data-native-rewrite-task=polish": 1,
    "data-native-rewrite-task=expand": 1,
    "data-native-rewrite-task=shorten": 1,
    "data-native-rewrite-task=style": 1,
    "data-native-rewrite-preset": 1,
    "data-native-rewrite-saved-prompt": 1,
    "data-native-rewrite-original-text": 1,
    "data-native-rewrite-instruction": 1,
    "data-native-rewrite-context-chars": 1,
    "data-native-preview-rewrite": 1,
    "data-native-start-rewrite": 1,
    "data-native-rewrite-regenerate": 1,
    "data-native-regenerate-instruction": 1,
    "data-native-regenerate-use-context": 1,
    "data-native-regenerate-context-chars": 1,
    "data-native-regenerate-selection": 1,
    "data-native-new-character": 1,
    "data-native-open-compendium": 1,
    "data-native-scene-summary": 1,
    "data-native-generate-scene-summary": 1,
    "data-native-generate-chapter-summary": 1,
    "data-native-summary-template": 1,
    "data-native-scene-tags": 1,
    "data-native-scene-pov": 1,
    "data-native-scene-tense": 1,
    "data-native-rename-chapter": 1,
    "data-native-delete-chapter": 1,
    "data-native-rename-scene": 1,
    "data-native-delete-scene": 1,
    "data-native-move-scene-up": 1,
    "data-native-move-scene-down": 1,
    "data-native-export-include-scene-titles": 1,
    "data-native-export-md": 1,
    "data-native-export-txt": 1,
    "data-native-export-html": 1,
    "data-native-export-epub": 1,
    "data-native-export-package": 1,
    "data-native-search": 1,
    "data-native-search-prev": 1,
    "data-native-search-next": 1,
    "data-native-replace": 1,
    "data-native-replace-current": 1,
    "data-native-replace-all": 1,
    "data-reader-writer-close": 1,
    "data-reader-writer-project": 1,
    "data-reader-writer-intent": 1,
    "data-reader-writer-chapter": 1,
    "data-reader-writer-scene": 1,
    "data-reader-writer-project-title": 1,
    "data-reader-writer-confirm": 1,
    "data-reader-writer-refresh": 1,
    "data-reader-writer-apply": 1,
    "data-native-prompt-template": 1,
    "data-native-manage-prompts": 1,
    "data-native-manage-global-prompt": 1,
    "data-native-generation-insert-mode": 1,
    "data-native-profile-select": 1,
    "data-native-model-select": 1,
    "data-native-custom-model": 1,
    "data-native-temperature": 1,
    "data-native-max-tokens": 1,
    "data-native-provider-defaults": 1,
    "data-native-close-writer-settings": 1,
    "data-native-close-prompt": 1,
    "data-native-summary-dialog-content": 1,
    "data-native-summary-dialog-save": 1,
    "data-native-summary-dialog-copy": 1,
    "data-native-summary-dialog-edit": 1,
    "data-native-summary-dialog-close": 1,
    "data-native-global-prompt-form": 1,
    "data-native-global-prompt-enabled": 1,
    "data-native-global-prompt-content": 1,
    "data-native-project-directive-enabled": 1,
    "data-native-project-directive-content": 1,
    "data-native-global-prompt-cancel": 1,
    "data-prompt-manager-form": 1,
    "data-prompt-manager-title": 1,
    "data-prompt-manager-category": 1,
    "data-prompt-manager-content": 1,
    "data-prompt-manager-system": 1,
    "data-prompt-manager-new": 1,
    "data-prompt-manager-delete": 1,
    "data-prompt-manager-close": 1
};
const html = fs.readFileSync(path.join(__dirname, '../desktop/fragments/writer.html'), 'utf8');

function controlCounts(source) {
    const counts = new Map();
    for (const match of source.matchAll(/<(button|input|select|textarea|form|details|summary)\b[^>]*>/g)) {
        for (const attr of match[0].matchAll(/\b(data-(?:native|reader-source|reader-writer|prompt-manager)[\w-]*)(?:="([^"]*)")?/g)) {
            const key = attr[1] + (attr[2] ? '=' + attr[2] : '');
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }
    return counts;
}
const counts = controlCounts(html);
const missing = Object.entries(baselineControls).filter(([identity, minimum]) => (counts.get(identity) || 0) < minimum);
assert.deepStrictEqual(missing, [], 'Original writer controls must remain, including original task/action values and repeated access points');

// A hidden duplicate editor or field can retain a selector but disconnect editing
// from the element cached by nativeEditorElements; duplication is not migration.
for (const identity of [
    'data-native-scene-editor', 'data-native-beat-input', 'data-native-rewrite-instruction',
    'data-native-rewrite-original-text', 'data-native-rewrite-preset', 'data-native-rewrite-saved-prompt',
    'data-native-regenerate-instruction', 'data-native-regenerate-use-context',
    'data-native-rewrite-context-chars', 'data-native-regenerate-context-chars',
    'data-native-scene-summary', 'data-native-scene-tags', 'data-native-scene-pov',
    'data-native-scene-tense', 'data-native-search', 'data-native-replace'
]) assert.strictEqual(counts.get(identity), 1, identity + ' must have one authoritative control');

for (const name of ['generate', 'rewrite', 'characters', 'context', 'metadata', 'structure', 'search', 'history']) {
    const panels = [...html.matchAll(/<section\b[^>]*\bdata-native-panel="([^"]+)"[^>]*>/g)].filter(match => match[1] === name);
    assert.strictEqual(panels.length, 1, name + ' must retain its native panel');
}
const presetSelect = html.match(/<select\b[^>]*\bdata-native-rewrite-preset\b[^>]*>([\s\S]*?)<\/select>/);
assert.ok(presetSelect, 'rewrite preset selector must remain');
const presetValues = [...presetSelect[1].matchAll(/<option\b[^>]*\bvalue="([^"]*)"/g)].map(match => match[1]);
for (const preset of ['balanced-polish', 'tighten', 'expand', 'show-dont-tell', 'dialogue-natural', 'character-voice', 'tension', 'pace-fast', 'continuity', 'literary', 'grammar-copyedit', 'custom']) {
    assert.ok(presetValues.includes(preset), 'Missing existing rewrite preset: ' + preset);
}
console.log('PASS static writer preservation: ' + Object.keys(baselineControls).length + ' baseline control identities, 8 panels, 12 rewrite presets, and unique stateful controls');
console.log('NOTE static coverage does not establish runtime reachability or functioning actions; run desk routing and writer behavior tests, then the migration acceptance checks.');
