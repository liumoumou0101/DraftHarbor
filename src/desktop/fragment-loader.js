(function () {
    const fragmentSelector = '[data-desktop-fragment]';

    async function loadFragment(placeholder) {
        const source = placeholder.getAttribute('data-desktop-fragment');
        if (!source) throw new Error('Desktop fragment source is missing.');
        const response = await fetch(source, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not load desktop fragment: ${source} (${response.status})`);
        const template = document.createElement('template');
        template.innerHTML = await response.text();
        placeholder.replaceWith(template.content);
    }

    async function loadDesktopFragments() {
        const placeholders = Array.from(document.querySelectorAll(fragmentSelector));
        await Promise.all(placeholders.map(loadFragment));
        document.documentElement.dataset.fragmentsReady = 'true';
    }

    window.DraftHarborFragmentsReady = loadDesktopFragments().catch((error) => {
        document.body.dataset.fragmentLoadFailed = 'true';
        console.error(error);
        throw error;
    });
})();
