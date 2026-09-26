import { Injectable } from '@angular/core';
import * as go from 'gojs';

const $ = go.GraphObject.make;

/**
 * Visual decision for one node's lock state. Produced by the component (pure,
 * covered) and merely applied to GoJS objects here.
 */
export interface LockVisual {
  opacity: number;
  stroke: string;
  strokeWidth: number;
  dash: number[] | null;
  cursor: string;
  tooltipText: string | null;
  isOwnLock: boolean;
}

/**
 * Everything the GoJS templates need from the component. Every member is a
 * pure function of component state, so the decisions stay unit-testable while
 * only the GoJS wiring lives in this file.
 */
export interface DiagramRenderHost {
  getDataTypeColor(dataType: string): string;
  buildAttributeTooltip(attribute: any): string;
  getAttributeFont(pk: boolean): string;
  getPkLabel(pk: boolean): string;
  getPrimaryTextStroke(): string;
  getSecondaryTextStroke(): string;
  getNodeFill(): string;
  getNodeStroke(): string;
  getHeaderBackground(): string;
  getLinkStroke(): string;
  isEntityLocked(entityId: string): boolean;
  getLockIcon(entityId: string): string;
  getLockStrokeColor(entityId: string): string;
  getLockUserLabel(entityId: string): string;
  resolveLockVisual(entityId: string): LockVisual;
  onDiagramModified(): void;
  entityClicked(entity: any): void;
  showTableEditorModal(entity: any): void;
  handleRemove(id: string): void;
  removeRelationship(id: string): void;
}

/**
 * GoJS boundary. EXCLUDED from coverage (see codeCoverageExclude in
 * angular.json): every statement here needs a live <canvas>, a real
 * `#myDiagramDiv` in the document, and a rendering pass to execute, so it
 * can only be exercised by rendering rather than by unit tests.
 *
 * Nothing in this file makes a decision - it constructs GoJS objects and
 * delegates every value to the host. The `.ofObject()` calls are preserved
 * exactly as they were written.
 */
@Injectable({
  providedIn: 'root'
})
export class DiagramRendererService {

  create(div: string | HTMLDivElement, host: DiagramRenderHost): go.Diagram {
    const diagram: go.Diagram = $(go.Diagram, div, {
      initialContentAlignment: go.Spot.Center,
      'animationManager.isEnabled': false,
      'undoManager.isEnabled': true,
      allowDelete: true,
      allowCopy: false,
      'toolManager.mouseWheelBehavior': go.ToolManager.WheelZoom,
      'clickCreatingTool.archetypeNodeData': { text: 'new node' },
      model: new go.GraphLinksModel([])
    });

    const itemTemplate = $(go.Panel, 'Horizontal',
      {
        margin: new go.Margin(4, 0, 4, 0),
        stretch: go.GraphObject.Horizontal,
        defaultAlignment: go.Spot.Left,
        toolTip: $('ToolTip',
          $(go.TextBlock,
            {
              margin: 4,
              font: '12px Inter, system-ui, sans-serif'
            },
            new go.Binding('text', '', (attribute: any) => host.buildAttributeTooltip(attribute))
          )
        )
      },
      $(go.Shape, 'Circle',
        {
          width: 10,
          height: 10,
          strokeWidth: 0,
          margin: new go.Margin(0, 6, 0, 2)
        },
        new go.Binding('fill', 'type', (type: string) => host.getDataTypeColor(type))
      ),
      $(go.TextBlock,
        {
          font: '14px Inter, system-ui, sans-serif',
          margin: new go.Margin(0, 6, 0, 0),
          maxSize: new go.Size(120, NaN),
          overflow: go.TextBlock.OverflowEllipsis
        },
        new go.Binding('text', 'name'),
        new go.Binding('stroke', '', () => host.getPrimaryTextStroke()),
        new go.Binding('font', 'pk', (pk: boolean) => host.getAttributeFont(pk))
      ),
      $(go.TextBlock,
        {
          font: 'bold 9px Inter, system-ui, sans-serif',
          stroke: '#f59e0b',
          margin: new go.Margin(0, 4, 0, 4)
        },
        new go.Binding('text', 'pk', (pk: boolean) => host.getPkLabel(pk)),
        new go.Binding('visible', 'pk')
      ),
      $(go.TextBlock,
        {
          font: '12px Inter, system-ui, sans-serif',
          stroke: '#6b7280',
          margin: new go.Margin(0, 4, 0, 0),
          maxSize: new go.Size(80, NaN),
          overflow: go.TextBlock.OverflowEllipsis
        },
        new go.Binding('text', 'type'),
        new go.Binding('stroke', '', () => host.getSecondaryTextStroke())
      )
    );

    diagram.nodeTemplate =
      $(go.Node, 'Auto',
        {
          selectionAdorned: true,
          resizable: true,
          layoutConditions: go.Part.LayoutStandard & ~go.Part.LayoutNodeSized,
          fromSpot: go.Spot.AllSides,
          toSpot: go.Spot.AllSides,
          isShadowed: true,
          shadowOffset: new go.Point(2, 2),
          shadowColor: 'rgba(0,0,0,0.2)',
          click: (e: go.InputEvent, node: go.GraphObject): void => {
            // @ts-ignore
            host.entityClicked(node.part.data);
          }
        },
        new go.Binding('location', 'location').makeTwoWay(),
        $(go.Shape, 'RoundedRectangle',
          {
            name: 'MAIN_SHAPE',
            fill: 'white',
            stroke: '#e5e7eb',
            strokeWidth: 1
          },
          new go.Binding('fill', '', () => host.getNodeFill()),
          new go.Binding('stroke', '', () => host.getNodeStroke())
        ),
        $(go.Panel, 'Table',
          {
            defaultAlignment: go.Spot.Left,
            margin: 0,
            minSize: new go.Size(220, NaN)
          },
          $(go.RowColumnDefinition, { row: 0, sizing: go.RowColumnDefinition.None }),
          $(go.RowColumnDefinition, { row: 1, sizing: go.RowColumnDefinition.None }),

          $(go.Panel, 'Horizontal',
            {
              row: 0,
              alignment: go.Spot.Center,
              stretch: go.GraphObject.Horizontal,
              background: '#f3f4f6',
              margin: new go.Margin(0, 0, 1, 0)
            },
            new go.Binding('background', '', () => host.getHeaderBackground()),
            $(go.TextBlock,
              {
                font: '16px bootstrap-icons',
                margin: new go.Margin(12, 6, 8, 10),
                text: ''
              },
              new go.Binding('stroke', '', () => host.getPrimaryTextStroke())
            ),
            $(go.TextBlock,
              {
                font: '600 18px Inter, system-ui, sans-serif',
                margin: new go.Margin(10, 4, 10, 0),
                maxSize: new go.Size(200, NaN),
                overflow: go.TextBlock.OverflowEllipsis
              },
              new go.Binding('text', 'key'),
              new go.Binding('stroke', '', () => host.getPrimaryTextStroke())
            ),
            $(go.Panel, 'Horizontal',
              {
                name: 'LOCK_INDICATOR',
                margin: new go.Margin(8, 8, 8, 4),
                background: 'transparent'
              },
              new go.Binding('visible', 'id', (entityId: string) =>
                host.isEntityLocked(entityId)).ofObject(),
              $(go.TextBlock,
                {
                  font: '12px Inter, system-ui, sans-serif',
                  margin: new go.Margin(0, 2, 0, 0)
                },
                new go.Binding('text', 'id', (entityId: string) =>
                  host.getLockIcon(entityId)).ofObject(),
                new go.Binding('stroke', 'id', (entityId: string) =>
                  host.getLockStrokeColor(entityId)).ofObject()
              ),
              $(go.TextBlock,
                {
                  font: '10px Inter, system-ui, sans-serif',
                  maxSize: new go.Size(80, NaN),
                  overflow: go.TextBlock.OverflowEllipsis
                },
                new go.Binding('text', 'id', (entityId: string) =>
                  host.getLockUserLabel(entityId)).ofObject(),
                new go.Binding('stroke', 'id', (entityId: string) =>
                  host.getLockStrokeColor(entityId)).ofObject()
              )
            )
          ),

          $(go.Panel, 'Vertical',
            {
              name: 'ATTRIBUTES',
              row: 1,
              margin: new go.Margin(8, 8, 8, 8),
              stretch: go.GraphObject.Horizontal,
              itemTemplate: itemTemplate,
              defaultAlignment: go.Spot.Left
            },
            new go.Binding('itemArray', 'items')
          )
        )
      );

    diagram.linkTemplate =
      $(go.Link,
        {
          routing: go.Link.AvoidsNodes,
          curve: go.Link.JumpOver,
          corner: 10,
          selectionAdorned: true,
          fromEndSegmentLength: 50,
          toEndSegmentLength: 50
        },
        $(go.Shape,
          {
            stroke: '#6b7280',
            strokeWidth: 2
          },
          new go.Binding('stroke', '', () => host.getLinkStroke())
        ),
        $(go.Shape,
          { toArrow: 'Standard', stroke: null },
          new go.Binding('fill', '', () => host.getLinkStroke())
        ),
        $(go.Panel, 'Auto',
          {
            segmentOffset: new go.Point(0, -12)
          },
          $(go.Shape, 'RoundedRectangle',
            {
              fill: host.getNodeFill(),
              stroke: host.getNodeStroke()
            }
          ),
          $(go.TextBlock,
            {
              text: '1',
              font: '600 12px Inter, system-ui, sans-serif',
              margin: 3
            },
            new go.Binding('text', 'text'),
            new go.Binding('stroke', '', () => host.getPrimaryTextStroke())
          )
        ),
        $(go.Panel, 'Auto',
          {
            segmentOffset: new go.Point(0, -12),
            segmentIndex: -1
          },
          $(go.Shape, 'RoundedRectangle',
            {
              fill: host.getNodeFill(),
              stroke: host.getNodeStroke()
            }
          ),
          $(go.TextBlock,
            {
              font: '600 12px Inter, system-ui, sans-serif',
              margin: 3
            },
            new go.Binding('text', 'toText'),
            new go.Binding('stroke', '', () => host.getPrimaryTextStroke())
          )
        )
      );

    diagram.nodeTemplate.doubleClick = (e: go.InputEvent, node: go.GraphObject): void => {
      // @ts-ignore
      const clickedNode = node.part.data;
      host.showTableEditorModal(clickedNode);
    };

    diagram.commandHandler.deleteSelection = (): void => {
      const selection: go.Set<go.Part> = diagram.selection;

      selection.each((part: go.Part): void => {
        if (part instanceof go.Node) {
          host.handleRemove(part.data.id);
        } else if (part instanceof go.Link) {
          host.removeRelationship(part.data.id);
        } else {
          return;
        }
      });

      go.CommandHandler.prototype.deleteSelection.call(diagram.commandHandler);
    };

    diagram.addDiagramListener('Modified', () => host.onDiagramModified());

    return diagram;
  }

  /** Applies the host's lock decision to every node. */
  applyLockStyling(diagram: go.Diagram, host: DiagramRenderHost): void {
    diagram.nodes.each((node: go.Node) => {
      const visual = host.resolveLockVisual(node.data.id);

      node.opacity = visual.opacity;

      const mainShape = node.findObject('MAIN_SHAPE') as go.Shape;
      if (mainShape && mainShape instanceof go.Shape) {
        mainShape.stroke = visual.stroke;
        mainShape.strokeWidth = visual.strokeWidth;
        mainShape.strokeDashArray = visual.dash;
      }

      node.cursor = visual.cursor;
      node.toolTip = visual.tooltipText === null
        ? null
        : this.createLockTooltip(visual.tooltipText, visual.isOwnLock);
    });
  }

  refreshBindings(diagram: go.Diagram): void {
    try {
      diagram.nodes.each((node: go.Node) => {
        const lockIndicator = node.findObject('LOCK_INDICATOR');
        if (lockIndicator) {
          node.updateTargetBindings();
        }
      });

      diagram.invalidateDocumentBounds();
    } catch (error) {
      console.error('Error refreshing diagram bindings:', error);
    }
  }

  private createLockTooltip(tooltipText: string, isOwnLock: boolean): go.Adornment {
    return $(go.Adornment, 'Auto',
      $(go.Shape, 'RoundedRectangle',
        {
          fill: isOwnLock ? '#10b981' : '#dc2626',
          stroke: null,
          opacity: 0.9
        }
      ),
      $(go.TextBlock, tooltipText,
        {
          font: '12px Inter, system-ui, sans-serif',
          stroke: 'white',
          margin: 8,
          maxSize: new go.Size(200, NaN),
          wrap: go.TextBlock.WrapFit
        }
      )
    );
  }

}
