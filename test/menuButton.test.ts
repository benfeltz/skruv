import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMenuButton } from '../src/ui/menuButton.js';
import { FakeElement, installFakeDom } from './support/fakeDom.js';
import type { FakeDom } from './support/fakeDom.js';

// 1.9.7.1.1: the hamburger menu holding Repack and Snap rotate. Driven headlessly on the
// fake DOM; where it sits and whether the closing tap also reaches the room is the phone pass.
let dom: FakeDom;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => vi.unstubAllGlobals());

type Menu = ReturnType<typeof createMenuButton>;
const mount = () => {
  const menu = createMenuButton({ name: 'Menu' });
  const element = menu.element as unknown as FakeElement;
  const [button, drop] = element.children;
  const control = (text: string) => Object.assign(new FakeElement('button', dom), { textContent: text });
  const add = (menu2: Menu, ...controls: FakeElement[]) => controls.forEach((c) => menu2.add(c as unknown as HTMLElement));
  const pointerDown = (target: FakeElement) => dom.windowListeners.get('pointerdown')?.forEach((fn) => fn({ target }));
  return { menu, element, button, drop, control, add, pointerDown };
};

describe('the menu button', () => {
  it('is closed by default, and its button opens then closes it', () => {
    const { menu, button, drop } = mount();
    expect(menu.isOpen()).toBe(false);
    expect(drop.hidden).toBe(true);
    expect(button.attributes['aria-expanded']).toBe('false');
    button.fire('click');
    expect(drop.hidden).toBe(false);
    expect(button.attributes['aria-expanded']).toBe('true');
    button.fire('click');
    expect(drop.hidden).toBe(true);
    expect(button.attributes['aria-expanded']).toBe('false');
  });

  it('names its drop for assistive tech', () => {
    const { button, drop } = mount();
    expect(button.attributes['aria-haspopup']).toBe('menu');
    expect(button.attributes['aria-controls']).toBe(drop.id);
    expect(drop.attributes.role).toBe('menu');
  });

  it('puts added controls in the drop, in order', () => {
    const { menu, drop, control, add } = mount();
    add(menu, control('Repack'), control('Snap rotate'));
    expect(drop.children.map((child) => child.textContent)).toEqual(['Repack', 'Snap rotate']);
  });

  it('closes on a pointerdown outside it, not on one inside', () => {
    const { menu, element, drop, control, add, pointerDown } = mount();
    const inside = control('Snap rotate');
    add(menu, inside);
    menu.open();
    pointerDown(inside);
    pointerDown(element.children[0]);
    expect(menu.isOpen()).toBe(true);
    expect(drop.hidden).toBe(false);
    pointerDown(dom.body);
    expect(menu.isOpen()).toBe(false);
  });

  it('closes on Escape', () => {
    const { menu } = mount();
    menu.open();
    dom.key('Escape');
    expect(menu.isOpen()).toBe(false);
  });

  it('ignores other keys', () => {
    const { menu } = mount();
    menu.open();
    dom.key('a');
    expect(menu.isOpen()).toBe(true);
  });

  it('closes after a click on an added control, but not on one marked to stay (Repack)', () => {
    const { menu, control, add } = mount();
    const snap = control('Snap rotate');
    const repack = control('Repack');
    add(menu, repack, snap);
    menu.open();
    repack.dataset.menuStay = 'true';
    repack.fire('click');
    expect(menu.isOpen()).toBe(true);
    menu.close();
    menu.open();
    snap.fire('click');
    expect(menu.isOpen()).toBe(false);
  });

  it('runs a control\'s onClose when the drop closes, once per close', () => {
    const { menu, control } = mount();
    const onClose = vi.fn();
    menu.add(control('Repack') as unknown as HTMLElement, { onClose });
    menu.open();
    dom.key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    menu.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dispose removes the window listeners and the element', () => {
    const { menu, element } = mount();
    const parent = new FakeElement('div', dom);
    parent.append(element);
    menu.dispose();
    expect(dom.windowListeners.get('pointerdown')).toEqual([]);
    expect(dom.windowListeners.get('keydown')).toEqual([]);
    expect(parent.children).toEqual([]);
  });
});
