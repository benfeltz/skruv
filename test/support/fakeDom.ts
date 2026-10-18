import { vi } from 'vitest';

// A minimal fake DOM, enough for src/ui/booklet.ts: elements that hold children, listeners,
// attributes and a dataset, events that bubble from the target up, one focused element, and
// window key listeners, a viewport width and height, and a root element whose style records custom properties. test/bookletSplash.test.ts carries its own copy of the same shape.

type FakeEvent = { type: string; target: FakeElement; pointerId: number; pointerType: string; button: number; detail: number; clientX: number; clientY: number; timeStamp: number };
type Listener = (event: object) => void;

/** The root element's style: just the custom properties a test reads back. */
export class FakeStyle {
  props: Record<string, string> = {};
  /** The root's `data-*`, as `dataset`. */
  dataset: Record<string, string> = {};
  setProperty(name: string, value: string) {
    this.props[name] = value;
  }
  removeProperty(name: string) {
    delete this.props[name];
  }
  /** The element the document hands out as `documentElement`: this style, and its dataset. */
  asRoot() {
    return { style: this, dataset: this.dataset };
  }
}

export class FakeElement {
  tag: string;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  hidden = false;
  disabled = false;
  textContent = '';
  className = '';
  captured: number[] = [];
  style: Record<string, string> = {};
  inert = false;
  /** The layout box a test can set, as the real element's `offset*`. */
  offsetWidth = 0;
  offsetLeft = 0;
  offsetTop = 0;
  /** The rect a test can set, as `getBoundingClientRect` returns it. */
  rect = { left: 0, top: 0, width: 0, height: 0 };
  getBoundingClientRect() {
    return this.rect;
  }
  declare id?: string;

  constructor(tag: string, private readonly dom: FakeDom) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  tabIndex = 0;
  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent = null;
  }
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(fn);
  }
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  focus() {
    this.dom.focused = this;
  }
  drawn: unknown = undefined;
  getContext() {
    return { drawImage: (source: unknown) => (this.drawn = source) };
  }
  contains(node: FakeElement | null): boolean {
    for (let up: FakeElement | null = node; up; up = up.parent) if (up === this) return true;
    return false;
  }
  closest(tag: string) {
    const up = (node: FakeElement | null): FakeElement | null => (node === null ? null : node.tag === tag ? node : up(node.parent));
    return up(this);
  }
  fire(type: string, init: Partial<FakeEvent> = {}) {
    const event: FakeEvent = { type, target: this, pointerId: 1, pointerType: 'mouse', button: 0, detail: 0, clientX: 0, clientY: 0, timeStamp: 0, ...init };
    const up = (node: FakeElement | null) => {
      if (node === null) return;
      for (const fn of node.listeners.get(type) ?? []) fn(event);
      up(node.parent);
    };
    up(this);
  }
}

export interface FakeDom {
  head: FakeElement;
  body: FakeElement;
  focused: FakeElement | null;
  windowListeners: Map<string, Listener[]>;
  /** The viewport's size, as `window.innerWidth` and `innerHeight`: a test sets it, then fires `resize`. */
  viewport: { width: number; height: number };
  /** `document.documentElement`'s style and dataset, where the strip sets its root variables and `data-strip`. */
  rootStyle: FakeStyle;
  /** `screen.orientation`'s listeners, or null to have no `screen.orientation` (the `orientationchange` fallback). */
  orientationListeners: Map<string, Listener[]> | null;
  /** Fires the orientation's `change` (the window's `orientationchange` where there is none), as turning the phone does. */
  rotate(): void;
  /** The safe-area insets `getComputedStyle` reports on the strip's probe (CSS px): a test sets the notch here, then fires `resize`. */
  safe: { left: number; right: number };
  /** Presses a key on the window. */
  key(name: string): void;
}

/** Stubs `document` and `window` with a fresh fake; the caller unstubs. */
export function installFakeDom(): FakeDom {
  const windowListeners = new Map<string, Listener[]>();
  const dom: FakeDom = {
    head: undefined as unknown as FakeElement,
    body: undefined as unknown as FakeElement,
    focused: null,
    windowListeners,
    viewport: { width: 1280, height: 800 },
    rootStyle: new FakeStyle(),
    safe: { left: 0, right: 0 },
    orientationListeners: new Map(),
    rotate: () => {
      const listeners = dom.orientationListeners ? dom.orientationListeners : windowListeners;
      listeners.get(dom.orientationListeners ? 'change' : 'orientationchange')?.forEach((fn) => fn({}));
    },
    key: (name) => windowListeners.get('keydown')?.forEach((fn) => fn({ key: name })),
  };
  dom.head = new FakeElement('head', dom);
  dom.body = new FakeElement('body', dom);
  vi.stubGlobal('document', {
    head: dom.head,
    body: dom.body,
    documentElement: dom.rootStyle.asRoot(),
    createElement: (tag: string) => new FakeElement(tag, dom),
    getElementById: (id: string) => dom.head.children.find((node) => node.id === id) ?? null,
  });
  vi.stubGlobal('window', {
    get innerWidth() {
      return dom.viewport.width;
    },
    get innerHeight() {
      return dom.viewport.height;
    },
    addEventListener: (type: string, fn: Listener) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: Listener) => windowListeners.set(type, (windowListeners.get(type) ?? []).filter((f) => f !== fn)),
  });
  const orientation = {
    addEventListener: (type: string, fn: Listener) => dom.orientationListeners?.set(type, [...(dom.orientationListeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: Listener) => dom.orientationListeners?.set(type, (dom.orientationListeners.get(type) ?? []).filter((f) => f !== fn)),
  };
  vi.stubGlobal('screen', {
    get orientation() {
      return dom.orientationListeners ? orientation : undefined;
    },
  });
  vi.stubGlobal('getComputedStyle', () => ({ paddingLeft: `${dom.safe.left}px`, paddingRight: `${dom.safe.right}px` }));
  return dom;
}
