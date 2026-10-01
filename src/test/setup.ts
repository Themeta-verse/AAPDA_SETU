import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Test environment setup.
 *
 * DOM CLEANUP IS EXPLICIT, NOT IMPLICIT
 * -------------------------------------
 * Testing Library only auto-registers its `afterEach(cleanup)` when it can see
 * a global `afterEach`. This file was not being loaded at all before the `test`
 * block existed in vite.config.ts, so nothing unmounted between tests and every
 * `render()` appended to `document.body` for the whole run.
 *
 * The visible symptom was tests failing with "Found multiple elements" purely
 * because of what earlier tests had left behind, and the process eventually
 * exhausting memory. Both symptoms had the same single cause, which is why the
 * fix is registered explicitly here rather than relied upon implicitly.
 */
afterEach(() => {
  cleanup();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

/**
 * jsdom has no ResizeObserver, which framer-motion and some chart paths touch on
 * mount. Without this a component that is otherwise correct crashes in tests
 * only, which sends people looking for a product bug that does not exist.
 */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * jsdom does not implement scrollIntoView. Several components call it to honour
 * "scroll to alerts" interactions, and an unimplemented method throws.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/**
 * jsdom has no IntersectionObserver, which framer-motion's `whileInView`
 * touches on mount. A full-page render (Index) otherwise crashes in tests
 * only, hiding the real regressions a page-level test is meant to catch.
 */
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
}
