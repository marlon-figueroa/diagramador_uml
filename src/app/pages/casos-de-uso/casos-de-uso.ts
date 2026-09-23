import { AfterViewInit, Component, ElementRef, OnDestroy, signal, viewChild } from '@angular/core';
import { dia, shapes } from '@joint/core';

const YELLOW = '#fff3b0';
const DARK = '#3f3f46';
const INK = '#111111';
const LABEL_ON_DARK = '#f5f5f5';
const FONT = 'PT Sans';

type ShapeTool = 'actor' | 'usecase' | 'system';
type ConnectorTool = 'association' | 'include' | 'extend' | 'generalization';
type Tool = 'select' | ShapeTool | ConnectorTool;

const Actor = dia.Element.define(
  'uml.Actor',
  {
    size: { width: 48, height: 96 },
    attrs: {
      hit: {
        width: 'calc(w)',
        height: 'calc(h)',
        fill: 'transparent',
        stroke: 'none',
      },
      head: {
        cx: 'calc(w / 2)',
        cy: 14,
        r: 12,
        stroke: INK,
        strokeWidth: 2,
        fill: YELLOW,
      },
      torso: {
        d: 'M calc(w / 2) 26 V 58',
        stroke: INK,
        strokeWidth: 2,
        fill: 'none',
      },
      arms: {
        d: 'M 4 40 H calc(w - 4)',
        stroke: INK,
        strokeWidth: 2,
        fill: 'none',
      },
      legs: {
        d: 'M calc(w / 2) 58 L 8 calc(h - 18) M calc(w / 2) 58 L calc(w - 8) calc(h - 18)',
        stroke: INK,
        strokeWidth: 2,
        fill: 'none',
      },
      label: {
        textAnchor: 'middle',
        textVerticalAnchor: 'top',
        x: 'calc(w / 2)',
        y: 'calc(h - 4)',
        fontFamily: FONT,
        fontSize: 14,
        fill: INK,
      },
    },
  },
  {
    markup: [
      { tagName: 'rect', selector: 'hit' },
      { tagName: 'circle', selector: 'head' },
      { tagName: 'path', selector: 'torso' },
      { tagName: 'path', selector: 'arms' },
      { tagName: 'path', selector: 'legs' },
      { tagName: 'text', selector: 'label' },
    ],
  },
);

@Component({
  selector: 'app-casos-de-uso',
  templateUrl: './casos-de-uso.html',
  styleUrl: './casos-de-uso.scss',
})
export class CasosDeUso implements AfterViewInit, OnDestroy {
  private readonly paperHost = viewChild.required<ElementRef<HTMLDivElement>>('paperHost');
  private graph?: dia.Graph;
  private paper?: dia.Paper;
  private paperWidth = 0;
  private sourceId: string | null = null;
  private selectedId: string | null = null;
  private ignoreRenameBlur = false;
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
  private readonly counts: Record<ShapeTool, number> = { actor: 0, usecase: 0, system: 0 };

  protected readonly tool = signal<Tool>('select');
  protected readonly hint = signal('Selecciona un componente y haz clic en el lienzo.');
  protected readonly editor = signal<{ id: string; kind: 'element' | 'link'; left: number; top: number } | null>(null);

  protected readonly components: { id: ShapeTool; label: string }[] = [
    { id: 'actor', label: 'Actor' },
    { id: 'usecase', label: 'Caso de uso' },
    { id: 'system', label: 'Sistema' },
  ];

  protected readonly connectors: { id: ConnectorTool; label: string }[] = [
    { id: 'association', label: 'Asociación' },
    { id: 'include', label: 'Inclusión' },
    { id: 'extend', label: 'Extensión' },
    { id: 'generalization', label: 'Generalización' },
  ];

  private readonly onResize = (): void => {
    const host = this.paperHost()?.nativeElement;
    if (!host || !this.paper) {
      return;
    }
    const width = Math.max(host.clientWidth, 320);
    if (width === this.paperWidth) {
      return;
    }
    this.paperWidth = width;
    this.paper.setDimensions(width, 640);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }
    if (!this.selectedId || !this.graph) {
      return;
    }
    event.preventDefault();
    this.removeSelection();
  };

  ngAfterViewInit(): void {
    const host = this.paperHost().nativeElement;
    const namespace = { ...shapes, uml: { Actor } };

    this.graph = new dia.Graph({}, { cellNamespace: namespace });
    this.paper = new dia.Paper({
      el: host,
      model: this.graph,
      width: Math.max(host.clientWidth, 320),
      height: 640,
      gridSize: 10,
      drawGrid: true,
      background: { color: '#ffffff' },
      cellViewNamespace: namespace,
    });

    this.paper.on('blank:pointerclick', (_evt: dia.Event, x: number, y: number) => {
      const current = this.tool();
      if (current === 'actor' || current === 'usecase' || current === 'system') {
        this.place(current, x, y);
        return;
      }
      this.sourceId = null;
      this.selectedId = null;
      this.paintElements(null);
      this.hint.set(this.hintFor(current));
    });

    this.paper.on('element:pointerclick', (elementView: dia.ElementView, evt: dia.Event) => {
      this.selectedId = String(elementView.model.id);
      this.paintElements(this.selectedId);
      if (this.clicks(evt) > 1 || !this.isConnector(this.tool())) {
        return;
      }
      this.connectFrom(elementView.model);
    });

    this.paper.on('element:pointerdblclick', (elementView: dia.ElementView) => {
      this.beginRename(elementView, 'element');
    });

    this.paper.on('link:pointerdblclick', (linkView: dia.LinkView) => {
      this.beginRename(linkView, 'link');
    });

    this.paper.on('link:pointerclick', (linkView: dia.LinkView) => {
      this.paintElements(null);
      if (this.tool() === 'select') {
        this.selectedId = String(linkView.model.id);
      }
    });

    this.paperWidth = Math.max(host.clientWidth, 320);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.paper?.remove();
    this.graph?.clear();
  }

  protected choose(next: Tool): void {
    const tool = this.tool() === next && next !== 'select' ? 'select' : next;
    this.tool.set(tool);
    this.sourceId = null;
    this.hint.set(this.hintFor(tool));
  }

  protected commitRename(): void {
    if (this.ignoreRenameBlur) {
      this.ignoreRenameBlur = false;
      return;
    }
    const current = this.editor();
    const input = this.renameInput()?.nativeElement;
    this.editor.set(null);
    if (!current || !input || !this.graph) {
      return;
    }
    const text = input.value.trim();
    if (!text) {
      return;
    }
    const cell = this.graph.getCell(current.id);
    if (!cell) {
      return;
    }
    if (current.kind === 'link') {
      cell.prop(['labels', 0, 'attrs', 'text', 'text'], text);
      return;
    }
    cell.attr('label/text', text);
  }

  protected cancelRename(): void {
    this.ignoreRenameBlur = true;
    this.editor.set(null);
  }

  protected removeSelection(): void {
    if (!this.selectedId || !this.graph) {
      return;
    }
    this.graph.getCell(this.selectedId)?.remove();
    if (this.sourceId === this.selectedId) {
      this.sourceId = null;
    }
    this.selectedId = null;
  }

  protected clearCanvas(): void {
    if (this.editor()) {
      this.ignoreRenameBlur = true;
      this.editor.set(null);
    }
    this.graph?.clear();
    this.selectedId = null;
    this.sourceId = null;
    this.counts.actor = 0;
    this.counts.usecase = 0;
    this.counts.system = 0;
  }

  private place(kind: ShapeTool, x: number, y: number): void {
    if (!this.graph) {
      return;
    }
    this.counts[kind] += 1;
    const index = this.counts[kind];
    const cell = this.createShape(kind, index);
    const size = cell.size();
    cell.position(x - size.width / 2, y - size.height / 2);
    cell.addTo(this.graph);
    this.selectedId = String(cell.id);
    this.paintElements(this.selectedId);
  }

  private createShape(kind: ShapeTool, index: number): dia.Element {
    if (kind === 'actor') {
      return new Actor({
        size: { width: 64, height: 120 },
        attrs: { label: { text: index === 1 ? 'Actor' : `Actor ${index}` } },
      });
    }

    if (kind === 'usecase') {
      return new shapes.standard.Ellipse({
        size: { width: 180, height: 84 },
        attrs: {
          body: { fill: YELLOW, stroke: INK, strokeWidth: 2 },
          label: {
            text: index === 1 ? 'Caso de uso' : `Caso de uso ${index}`,
            fill: INK,
            fontFamily: FONT,
            fontSize: 14,
          },
        },
      });
    }

    return new shapes.standard.Rectangle({
      size: { width: 280, height: 200 },
      attrs: {
        body: { fill: YELLOW, stroke: INK, strokeWidth: 2 },
        label: {
          text: index === 1 ? 'Sistema' : `Sistema ${index}`,
          fill: INK,
          fontFamily: FONT,
          fontSize: 15,
          fontWeight: 'bold',
          refY: 20,
          textVerticalAnchor: 'top',
        },
      },
    });
  }

  private connectFrom(model: dia.Element): void {
    const id = String(model.id);
    if (!this.sourceId) {
      this.sourceId = id;
      this.hint.set('Ahora haz clic en el componente destino.');
      return;
    }
    if (this.sourceId === id) {
      return;
    }
    this.addConnector(this.sourceId, id, this.tool() as ConnectorTool);
    this.sourceId = null;
    this.hint.set(this.hintFor(this.tool()));
  }

  private addConnector(source: string, target: string, kind: ConnectorTool): void {
    if (!this.graph) {
      return;
    }
    const dashed = kind === 'include' || kind === 'extend';
    const label = kind === 'include' ? '«include»' : kind === 'extend' ? '«extend»' : '';
    const targetMarker =
      kind === 'association'
        ? { type: 'path', d: 'M 0 0' }
        : kind === 'generalization'
          ? { type: 'path', d: 'M 14 -7 0 0 14 7 z', fill: '#ffffff', stroke: INK }
          : { type: 'path', d: 'M 10 -5 0 0 10 5 z', fill: INK, stroke: INK };

    const link = new shapes.standard.Link({
      source: { id: source },
      target: { id: target },
      attrs: {
        line: {
          stroke: INK,
          strokeWidth: 1.6,
          ...(dashed ? { strokeDasharray: '7 4' } : {}),
          targetMarker,
        },
      },
      labels: label
        ? [
            {
              attrs: {
                text: { text: label, fill: INK, fontFamily: FONT, fontSize: 13 },
                rect: { fill: YELLOW, stroke: INK },
              },
            },
          ]
        : [],
    });
    link.addTo(this.graph);
    this.selectedId = String(link.id);
  }

  private paintElements(selectedId: string | null): void {
    if (!this.graph) {
      return;
    }
    for (const element of this.graph.getElements()) {
      const selected = String(element.id) === selectedId;
      const fill = selected ? DARK : YELLOW;
      const label = selected ? LABEL_ON_DARK : INK;
      if (element.get('type') === 'uml.Actor') {
        element.attr('head/fill', fill);
        element.attr('label/fill', label);
      } else {
        element.attr('body/fill', fill);
        element.attr('label/fill', label);
      }
    }
  }

  private beginRename(view: dia.ElementView | dia.LinkView, kind: 'element' | 'link'): void {
    const text =
      kind === 'element'
        ? String(view.model.attr('label/text') ?? '')
        : String(view.model.prop(['labels', 0, 'attrs', 'text', 'text']) ?? '');
    const node = view.el.querySelector('text');
    const rect = (node ?? view.el).getBoundingClientRect();
    this.editor.set({
      id: String(view.model.id),
      kind,
      left: rect.left,
      top: Math.min(rect.bottom + 8, window.innerHeight - 48),
    });
    this.sourceId = null;
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        const input = this.renameInput()?.nativeElement;
        if (!input) {
          return;
        }
        input.value = text;
        input.focus();
        input.select();
      });
    });
  }

  private clicks(evt: dia.Event): number {
    const original = evt.originalEvent as MouseEvent | undefined;
    return original?.detail ?? 1;
  }

  private isConnector(tool: Tool): tool is ConnectorTool {
    return tool === 'association' || tool === 'include' || tool === 'extend' || tool === 'generalization';
  }

  private hintFor(tool: Tool): string {
    if (tool === 'select') {
      return 'Arrastra los componentes. Doble clic edita el texto. Supr los elimina.';
    }
    if (tool === 'actor' || tool === 'usecase' || tool === 'system') {
      return 'Haz clic en el lienzo para agregar el componente.';
    }
    return 'Haz clic en el origen y luego en el destino. La línea queda en negro.';
  }
}
