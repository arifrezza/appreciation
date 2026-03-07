import Quill from 'quill';

const Inline = Quill.import('blots/inline') as any;

class SpellErrorBlot extends Inline {
  static blotName = 'spell-error';
  static tagName = 'span';
  static className = 'ql-spell-error';

  static create(value: string): HTMLElement {
    const node = super.create() as HTMLElement;
    node.setAttribute('data-word', value);
    return node;
  }

  static formats(node: HTMLElement): string | undefined {
    return node.getAttribute('data-word') || undefined;
  }
}

Quill.register(SpellErrorBlot, true);

export default SpellErrorBlot;
