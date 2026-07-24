/*
 * DraftHarbor still loads the renderer as ordered classic scripts. Keep the
 * cross-script surface explicit here so ESLint can continue to catch new
 * misspellings without pretending every established shell dependency is an
 * undefined variable. Remove entries from this manifest as files migrate to
 * modules; do not generate it dynamically from lint output.
 */
const legacyShellGlobalNames = `
acceptNativeGeneration
acceptNativeRewrite
activateReaderTransferTarget
activeWorkflowStep
addNativeChapter
addNativeScene
applyDesktopTheme
applyDesktopThemeFromStorage
applyNativeAutoReplace
applyNativeEditorPrefs
applyReaderPreferenceModel
applyReaderSettings
beginNativeSceneTitleEdit
beginWorkflowReasoning
beginWorkflowReasoningBatch
bindCompendium
bindCompendiumAgent
bindCompendiumAgentQa
bindCompendiumDraw
bindCompendiumRewrite
bindContextStrip
bindNativeCompendiumExtraction
bindNativeEditor
bindNativeGlobalPrompt
bindNativeSidebarResize
bindNavigation
bindProjectCreator
bindProjectEditor
bindProjectLibrary
bindReader
bindReaderCompendiumTransfer
bindReaderTransferConsumers
bindReaderWorkflowTransfer
bindReaderWriterTransfer
bindRecovery
bindSettings
bindStyleGuard
bindWindowControls
bindWorkflow
bindWorkshop
buildNativeRegenerateSelectionPrompt
buildNativeRewritePrompt
appendWorkflowReasoning
cancelNativeGeneration
captureReaderPositionLocator
clampNumber
clearReaderLayoutCache
clearReaderTransferSelection
closeNativeWriterPopovers
closeNativeSummaryDialog
closeProjectCreator
closeProjectEditor
compendiumReferencesPromptBlock
compendiumState
contextPolicyLabel
contextPolicyMode
contextStripElements
copyNativeSummaryDialog
countNativeWords
createCompendiumEntry
createProjectFromDesktop
createReaderLocatorAt
createWorkshopSession
currentNativeChapter
currentNativeChapterByState
currentNativeScene
currentProjectId
currentProjectName
deleteNativeChapter
deleteNativeScene
deletePromptTemplate
discardNativeGeneration
downloadNativeExport
downloadNativeProjectPackage
DraftHarborCompendiumAgentPolicy
DraftHarborModelCatalog
editNativeSummaryDialog
EXPORT_OPTIONS_STORAGE_KEY
fetchProjectSnapshot
filteredCompendiumEntries
finishWorkflowReasoning
finishNativeSceneTitleEdit
firstBookGlyph
flushNativeEditorFields
formatDate
formatNumber
generateGuidedWorkflowNode
generateNativeSummary
getNativeAITaskRunner
getState
handleReaderWorkspaceEscape
importProjectPackageFile
importProjectSnapshotFile
importReaderFile
importWritingway1Files
initializeReaderNavigation
initializeReaderNavigationDocument
initializeReaderSelection
initializeReaderSettings
initializeReaderWorkspace
insertNativeSpecialChar
loadCompendium
loadExportOptions
loadNativeContextPrefs
loadNativeEditorPrefs
loadNativeProjectEditor
loadProjectLibrary
loadPrompts
loadReaderFromProjectSnapshot
loadReaderLibrary
loadReaderState
loadReaderWorkspaceChapter
loadRecoveryList
loadRewritePrompts
loadSettings
loadSummaryPrompts
loadWorkflowEvents
loadWorkflowGraphTemplates
loadWorkflowRuns
loadWorkshopSessions
loadWriterModelOverride
markNativeDirty
markWorkflowAnswerStarted
maybeShiftReaderFlowWindow
migrateLegacyReaderState
modelCatalog
moveNativeScene
NATIVE_EDITOR_PREFS_STORAGE_KEY
nativeAvoidanceInstruction
nativeEditorElements
nativeEditorState
nativeGenerationConfig
nativeGenerationHistory
nativeSceneContent
nativeSelectedOrSceneExcerpt
navigateNativeSearchMatch
navigateReaderToLocator
navigateReaderWorkspaceChapter
newPromptTemplate
normalizeDesktopSettings
normalizeDesktopTheme
openCompendiumAgent
openCompendiumAgentQa
openCompendiumDraw
openCompendiumRewrite
openDesktopProject
openNativeCompendiumExtraction
openNativeEditorContextMenu
openNativeSummaryDialog
openProjectCreator
openProjectFolder
openReaderCompendiumTransfer
openReaderLibraryDocument
openReaderWorkflowTransfer
openReaderWriterTransfer
parseCommaList
persistReaderNavigationState
profileEditState
profileTestState
projectCreatorElements
projectEditorElements
projectLibraryState
promptState
queueReaderDocumentStateWrite
queueReaderPageTurn
readCoverFile
READER_STORAGE_KEY
readerActualFontFamily
readerApi
readerDrawerFocusable
readerEffectiveTransition
readerElements
readerFontStack
readerState
readNativeSceneAloud
recoveryState
refreshReaderBookmarkResolutions
rememberReaderScroll
renameNativeChapter
renameNativeScene
renderCompendium
renderCompendiumReferencePicker
renderContextStrip
renderCoverPreview
renderNativeCharacters
renderNativeContext
renderNativeEditor
renderNativeGeneration
renderNativeRewrite
renderProjectLibrary
renderPromptManager
renderReader
renderReaderLibrary
renderReaderReading
renderReaderWorkspace
renderWorkflowReasoningBubble
renderGuidedWorkflowInlineResult
renderGuidedWorkflowRecoveryActions
resumeGuidedWorkflowRun
renderSummaryPromptTemplates
renderWorkflow
renderWorkflowGraph
renderWorkshop
renderWriterModelControl
replaceNativeText
rewriteInstructionText
rewritePromptState
runtimeProviderConfig
saveExportOptions
saveNativeEditorPrefs
saveNativeScene
saveProjectEditor
savePromptTemplate
saveReaderState
saveWriterGenerationDefaults
saveWriterModelOverride
scheduleReaderPreferenceSave
scheduleReaderReflow
selectedCompendiumEntry
selectedCompendiumReferenceCards
selectedWorkflowRun
selectedPromptTemplate
selectedSummaryPromptTemplate
selectedWorkshopSession
sendNativeSelectionToWorkshop
setCompendiumStatus
setNativeSaveStatus
setProjectCreatorStatus
setProjectEditorStatus
setProjectLibraryCount
setProjectLibraryMeta
setProjectLibraryStatus
setReaderDrawer
setShelfStatus
settingsState
settingsWithRuntimeProfiles
setView
setWorkflowStatus
shellUiState
showNativePromptPreview
showNativeRewritePreview
startNativeGeneration
startNativeRegenerateSelection
startNativeRewrite
stopNativeReading
summaryPromptState
switchNativeScene
syncReaderSettingsControls
toggleFullscreen
triggerDownload
TTS_SPEED_KEY
TTS_VOICE_KEY
updateNativeSearchMatchState
updateNativeStats
updateReaderNavigationProgress
updateReaderProgress
updateReaderWorkspaceProgress
workflowElements
workflowGenerationLaunchConfig
workflowGenerationPolicy
workflowConfigLabel
guidedStageProviderConfig
workflowLockConstraints
workflowState
workshopState
WRITER_MODEL_KEY
writerEffectiveProfile
writerModelOverride
writerSelectedModelId
`.trim().split(/\s+/);

const legacyShellGlobals = Object.fromEntries(
    legacyShellGlobalNames.map((name) => [name, 'writable'])
);

const playwrightPageGlobals = Object.fromEntries([
    'captureReaderPositionLocator',
    'loadSummaryPrompts',
    'loadReaderWorkspaceChapter',
    'persistReaderNavigationState',
    'queueReaderPageTurn',
    'readerDrawerFocusable',
    'readerEffectiveTransition',
    'readerState',
    'refreshReaderBookmarkResolutions',
    'renderReaderReading'
].map((name) => [name, 'readonly']));

module.exports = {
    root: true,
    env: {
        es2021: true
    },
    extends: 'eslint:recommended',
    parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'script'
    },
    rules: {
        'no-console': 'off',
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        'no-undef': 'error',
        'no-empty': 'off',
        'no-constant-condition': 'off'
    },
    overrides: [
        {
            files: ['.eslintrc.js'],
            env: { node: true }
        },
        {
            files: ['desktop/**/*.js', 'tests/**/*.js'],
            env: { node: true }
        },
        {
            files: ['tests/**/*.js'],
            // Playwright callbacks execute in the renderer even though the
            // surrounding test runner is Node.js.
            env: { browser: true }
        },
        {
            files: ['src/**/*.js'],
            env: { browser: true, node: true },
            globals: {
                DraftHarborCompendiumAgentPolicy: 'readonly',
                DraftHarborModelCatalog: 'readonly'
            }
        },
        {
            files: ['src/desktop/shell/**/*.js'],
            globals: legacyShellGlobals,
            // Top-level declarations are consumed by later classic scripts.
            'rules': {
                'no-unused-vars': 'off'
            }
        },
        {
            files: [
                'tests/desktop-reader.js',
                'tests/reader-layout-audit.js',
                'tests/reader-realistic-visual-audit.js',
                'tests/writer-button-audit.js'
            ],
            globals: playwrightPageGlobals
        }
    ]
};
