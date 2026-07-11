(function () {
    const STORAGE_KEY = 'draftharbor:desktop:lastView';
    const DEFAULT_VIEW = 'bookshelf';
    const VALID_VIEWS = new Set(['bookshelf', 'writer', 'reader', 'compendium', 'workshop', 'workflow', 'recovery', 'settings']);

    function normalizeView(view) {
        return VALID_VIEWS.has(view) ? view : DEFAULT_VIEW;
    }

    function loadInitialView() {
        try {
            return normalizeView(localStorage.getItem(STORAGE_KEY));
        } catch (e) {
            return DEFAULT_VIEW;
        }
    }

    function saveView(view) {
        try {
            localStorage.setItem(STORAGE_KEY, normalizeView(view));
        } catch (e) {
            // Ignore storage errors; navigation should still work.
        }
    }

    window.DraftHarborDesktopState = {
        defaultView: DEFAULT_VIEW,
        views: Array.from(VALID_VIEWS),
        normalizeView,
        loadInitialView,
        saveView
    };
})();
