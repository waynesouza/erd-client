import { Component, Input, OnDestroy, OnInit, ViewChild, ElementRef } from '@angular/core';
import * as go from 'gojs';
import { Client } from '@stomp/stompjs';
import * as SockJS from 'sockjs-client';
import { DiagramService } from '../service/diagram.service';
import { DiagramModel } from '../model/diagram.model';
import { EntityModel } from '../model/entity.model';
import { SharedService } from '../service/shared.service';
import { IntermediaryEntityModel } from '../model/intermediary-entity.model';
import { AttributeModel } from '../model/attribute.model';
import { LinkDataModel } from '../model/link-data.model';
import { DdlService } from '../service/ddl.service';
import { CollaborationService, EntityLock, CollaborationMessage } from '../service/collaboration.service';
import { ProjectService } from '../service/project.service';
import { Project } from '../model/project.model';
import { StorageService } from '../service/storage.service';
import { AuthResponseModel } from '../model/auth-response.model';
import { SqlValidationService, ValidationResult } from '../service/sql-validation.service';
import { environment } from '../../environments/environment';
import { StompSubscription } from '@stomp/stompjs';

const $ = go.GraphObject.make;

@Component({
  selector: 'app-diagram',
  templateUrl: './diagram.component.html',
  styleUrls: ['./diagram.component.css']
})
export class DiagramComponent implements OnInit, OnDestroy {

  @Input() entities: EntityModel[] = [];
  @Input() selectedProjectId: string = '';
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  relationships: any[] = [];
  locations: go.Point[] = [];
  darkMode: boolean = false;
  showTableEditor: boolean = false;
  showLegend: boolean = false;
  selectedItem: any = null;
  selectedEntity: any = {};
  selectedRelationshipType: '1:1' | '1:N' | 'N:N' | null = null;
  selectedEntities: any[] = [];
  projectId: string = '';
  isEntityEditorModalOpen: boolean = false;

  // Collaboration properties
  currentProject: Project | null = null;
  currentUser: AuthResponseModel | null = null;
  userRole: string = 'NONE';
  canEdit: boolean = false;
  lockedEntities: EntityLock[] = [];

  // @ts-ignore
  public diagram: go.Diagram = null;

  private stompClient!: Client;
  private diagramSubscription: StompSubscription | null = null;
  private collaborationSubscription: StompSubscription | null = null;

  constructor(
    private diagramService: DiagramService,
    private sharedService: SharedService,
    private ddlService: DdlService,
    private collaborationService: CollaborationService,
    private projectService: ProjectService,
    private storageService: StorageService,
    private sqlValidationService: SqlValidationService
  ) {
    this.currentUser = this.storageService.getUser();
  }

  ngOnInit(): void {
    // WebSocket configuration using @stomp/stompjs
    const wsBaseUrl = environment.apiUrl.replace('/api', '');
    this.stompClient = new Client({
      webSocketFactory: () => new SockJS(`${wsBaseUrl}/ws`),
      connectHeaders: {},
      debug: (str: string) => {
        console.log('STOMP Debug:', str);
      },
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
    });

    this.stompClient.onConnect = (frame: any) => {
      console.log('Connected: ' + frame);
      this.subscribeToProjectTopics();
    };

    this.stompClient.onStompError = (frame: any) => {
      console.error('Broker reported error: ' + frame.headers['message']);
      console.error('Additional details: ' + frame.body);
    };

    this.stompClient.activate();

    // Monitor project changes and load data with permissions
    this.sharedService.currentProjectId.subscribe((projectId: any) => {
      if (projectId) {
        this.projectId = projectId;
        this.subscribeToProjectTopics();
        this.loadProjectData(projectId);
        this.loadDiagramData(projectId);
      } else {
        this.unsubscribeFromProjectTopics();
        this.clearProjectData();
      }
    });

    // Monitor entity locks and update diagram in real time
    this.collaborationService.lockedEntities$.subscribe((locks: EntityLock[]) => {
      console.log('Locks updated via WebSocket:', locks);
      this.lockedEntities = locks;
      // Update diagram immediately when locks change
      setTimeout(() => {
        this.updateDiagramLockStates();
        this.refreshDiagramBindings();
      }, 100);
    });
  }

  private loadProjectData(projectId: string): void {
    this.projectService.getProjectById(projectId).subscribe({
      next: (project: Project) => {
        this.currentProject = project;
        this.userRole = this.collaborationService.getCurrentUserRole(project.usersDto);
        this.canEdit = this.collaborationService.canEditDiagram(project.usersDto);

        console.log('User role in project:', this.userRole);
        console.log('Can edit diagram:', this.canEdit);

        // First clear orphaned locks of the current user
        this.collaborationService.clearUserLocks().subscribe({
          next: () => {
            console.log('User locks cleared successfully');
            // Then load existing project locks
            this.loadProjectLocks(projectId);
          },
          error: (error: any) => {
            console.warn('Error clearing user locks:', error);
            // Continue even if you can't clear
            this.loadProjectLocks(projectId);
          }
        });
      },
      error: (error: any) => {
        console.error('Error loading project data:', error);
        this.currentProject = null;
        this.userRole = 'NONE';
        this.canEdit = false;
      }
    });
  }

  private loadProjectLocks(projectId: string): void {
    this.collaborationService.getProjectLocks(projectId).subscribe({
      next: (locks: EntityLock[]) => {
        console.log('Loaded project locks:', locks);
        this.lockedEntities = locks;
        this.updateDiagramLockStates();
      },
      error: (error: any) => {
        console.error('Error loading project locks:', error);
      }
    });
  }

  private clearProjectData(): void {
    this.currentProject = null;
    this.userRole = 'NONE';
    this.canEdit = false;
    this.collaborationService.clearProjectLocks();
  }

  private updateDiagramLockStates(): void {
    if (!this.diagram) return;

    // Update visual appearance of entities based on locks
    this.diagram.nodes.each((node: go.Node) => {
      const entity = node.data;
      const isLocked = this.collaborationService.isEntityLockedByOtherUser(entity.id);
      const isLockedByMe = this.collaborationService.isEntityLockedByCurrentUser(entity.id);
      const lockInfo = this.lockedEntities.find(lock => lock.entityId === entity.id);

      // Find the main shape of the entity and cast it to go.Shape
      const mainShapeObj = node.findObject('MAIN_SHAPE');
      const mainShape = mainShapeObj as go.Shape;

      if (isLocked && lockInfo) {
        // Entity locked by another user - locked look
        node.opacity = 0.7;
        if (mainShape && mainShape instanceof go.Shape) {
          mainShape.stroke = '#dc2626'; // Red for blocked
          mainShape.strokeWidth = 3;
          mainShape.strokeDashArray = [8, 4]; // Dotted line
        }
        // Add "not allowed" cursor
        node.cursor = 'not-allowed';
        // Add tooltip with lock information
        node.toolTip = this.createLockTooltip(lockInfo, false);
      } else if (isLockedByMe && lockInfo) {
        // Entity locked by current user - edit view
        node.opacity = 1.0;
        if (mainShape && mainShape instanceof go.Shape) {
          mainShape.stroke = '#10b981'; // Green for editing
          mainShape.strokeWidth = 3;
          mainShape.strokeDashArray = null; // Solid line
        }
        node.cursor = 'pointer';
        node.toolTip = this.createLockTooltip(lockInfo, true);
      } else {
        // Available entity
        node.opacity = 1.0;
        if (mainShape && mainShape instanceof go.Shape) {
          mainShape.stroke = this.darkMode ? '#4b5563' : '#e5e7eb';
          mainShape.strokeWidth = 1;
          mainShape.strokeDashArray = null;
        }
        node.cursor = 'pointer';
        node.toolTip = null;
      }
    });
  }

  private createLockTooltip(lockInfo: EntityLock, isOwnLock: boolean): go.Adornment {
    const tooltipText = isOwnLock
      ? `🔓 You are editing this entity\nLocked at: ${new Date(lockInfo.lockedAt).toLocaleString()}`
      : `🔒 Being edited by: ${lockInfo.userName}\nLocked at: ${new Date(lockInfo.lockedAt).toLocaleString()}`;

    return $(go.Adornment, "Auto",
      $(go.Shape, "RoundedRectangle",
        {
          fill: isOwnLock ? '#10b981' : '#dc2626',
          stroke: null,
          opacity: 0.9
        }
      ),
      $(go.TextBlock, tooltipText,
        {
          font: "12px Inter, system-ui, sans-serif",
          stroke: "white",
          margin: 8,
          maxSize: new go.Size(200, NaN),
          wrap: go.TextBlock.WrapFit
        }
      )
    );
  }

  private loadDiagramData(projectId: string): void {
    this.diagramService.getDiagram(projectId).subscribe({
      next: (diagramData: DiagramModel) => {
        console.log('Received diagram data:', diagramData);
        if (diagramData && diagramData.nodeDataArray) {
          this.locations = diagramData.nodeDataArray.map((entity: EntityModel) => {
            return new go.Point(Number(entity.location?.x || 0), Number(entity.location?.y || 0));
          });
          this.entities = diagramData.nodeDataArray;
          this.relationships = diagramData.linkDataArray || [];
          this.setupDiagram();
        } else {
          console.error('Invalid diagram data received:', diagramData);
          this.setupEmptyDiagram();
        }
      },
      error: (error) => {
        console.error('Error loading diagram:', error);
        this.setupEmptyDiagram();
      }
    });
  }

  private setupDiagram(): void {
    this.initializeDiagram();
    if (this.entities.length > 0 || this.relationships.length > 0) {
      this.remakeDiagram();
    }
  }

  private setupEmptyDiagram(): void {
    this.entities = [];
    this.relationships = [];
    this.locations = [];
    this.initializeDiagram();
  }

  private subscribeToProjectTopics(): void {
    if (!this.stompClient?.connected || !this.projectId) {
      return;
    }

    this.unsubscribeFromProjectTopics();

    this.diagramSubscription = this.stompClient.subscribe(`/topic/diagram/${this.projectId}`, (message: any) => {
      console.log('Received message from server:', message);
      this.receiveMessageAndRemakeDiagram(message);
    });

    this.collaborationSubscription = this.stompClient.subscribe(`/topic/collaboration/${this.projectId}`, (message: any) => {
      const collaborationMessage: CollaborationMessage = JSON.parse(message.body);
      this.collaborationService.processCollaborationMessage(collaborationMessage);
    });
  }

  private unsubscribeFromProjectTopics(): void {
    if (this.diagramSubscription) {
      this.diagramSubscription.unsubscribe();
      this.diagramSubscription = null;
    }
    if (this.collaborationSubscription) {
      this.collaborationSubscription.unsubscribe();
      this.collaborationSubscription = null;
    }
  }

  ngOnDestroy(): void {
    this.unsubscribeFromProjectTopics();
    if (this.diagram) {
      this.diagram.div = null;
      // @ts-ignore
      this.diagram = null;
    }
    if (this.stompClient) {
      this.stompClient.deactivate().then();
    }
  }

  private initializeDiagram(): void {
    if (this.diagram) {
      this.diagram.div = null;
      // @ts-ignore
      this.diagram = null;
    }

    this.diagram = $(go.Diagram, 'myDiagramDiv', {
      initialContentAlignment: go.Spot.Center,
      "animationManager.isEnabled": false,
      "undoManager.isEnabled": true,
      allowDelete: true,
      allowCopy: false,
      "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
      "clickCreatingTool.archetypeNodeData": { text: "new node" },
      model: new go.GraphLinksModel([])
    });

    this.diagram.model = new go.GraphLinksModel({nodeDataArray: this.entities});

    // Helper functions for GoJS bindings
    const getDataTypeIcon = (dataType: string): string => {
      const iconMap: { [key: string]: string } = {
        'INTEGER': '🔢', 'BIGINT': '🔢', 'DECIMAL': '💰', 'NUMERIC': '💰',
        'VARCHAR': '📝', 'CHAR': '🔤', 'TEXT': '📄', 'BOOLEAN': '☑️',
        'DATE': '📅', 'DATETIME': '🗓️', 'TIMESTAMP': '⏰', 'TIME': '🕐', 'UUID': '🆔'
      };
      return iconMap[dataType] || '⚪';
    };

    const getAttributeIconColor = (attribute: any): string => {
      if (attribute.pk) return '#dc2626';
      if (attribute.fk) return '#f59e0b';
      if (attribute.unique) return '#8b5cf6';
      return '#6366f1';
    };

    const getAttributeIconShape = (attribute: any): string => {
      if (attribute.pk) return 'Diamond';
      if (attribute.fk) return 'Triangle';
      if (attribute.unique) return 'Pentagon';
      return 'Circle';
    };

    const getAttributeSuffix = (attribute: any): string => {
      const suffixes = [];
      if (attribute.pk) suffixes.push('PK');
      if (attribute.fk) suffixes.push('FK');
      if (attribute.unique && !attribute.pk) suffixes.push('UQ');
      if (attribute.autoIncrement) suffixes.push('AI');
      if (!attribute.nullable) suffixes.push('NN');
      return suffixes.length > 0 ? ` (${suffixes.join(', ')})` : '';
    };

    const itemTemplate = $(go.Panel, "Horizontal",
      {
        margin: new go.Margin(4, 0, 4, 0),
        stretch: go.GraphObject.Horizontal,
        defaultAlignment: go.Spot.Left
      },
      // Data type icon (emoji)
      $(go.TextBlock,
        {
          font: "14px Inter, system-ui, sans-serif",
          margin: new go.Margin(0, 6, 0, 0),
          width: 18,
          textAlign: "center"
        },
        new go.Binding("text", "type", getDataTypeIcon)
      ),
      // Shape indicator (geometric shape for PK/FK/UNIQUE)
      $(go.Shape,
        {
          width: 10,
          height: 10,
          margin: new go.Margin(0, 6, 0, 0),
        },
        new go.Binding("figure", "", getAttributeIconShape),
        new go.Binding("fill", "", getAttributeIconColor),
        new go.Binding("stroke", "", (attribute) => {
          const color = getAttributeIconColor(attribute);
          return color === '#dc2626' ? '#b91c1c' :
                 color === '#f59e0b' ? '#d97706' :
                 color === '#8b5cf6' ? '#7c3aed' : '#4f46e5';
        })
      ),
      // Attribute name
      $(go.TextBlock,
        {
          font: "14px Inter, system-ui, sans-serif",
          margin: new go.Margin(0, 6, 0, 0),
          maxSize: new go.Size(100, NaN),
          overflow: go.TextBlock.OverflowEllipsis
        },
        new go.Binding("text", "name"),
        new go.Binding("stroke", "", () => this.darkMode ? "#f3f4f6" : "#1f2937"),
        new go.Binding("font", "pk", (pk) =>
          pk ? "bold 14px Inter, system-ui, sans-serif" : "14px Inter, system-ui, sans-serif"
        )
      ),
      // Data type
      $(go.TextBlock,
        {
          font: "12px Inter, system-ui, sans-serif",
          stroke: "#6b7280",
          margin: new go.Margin(0, 4, 0, 0),
          maxSize: new go.Size(60, NaN),
          overflow: go.TextBlock.OverflowEllipsis
        },
        new go.Binding("text", "type"),
        new go.Binding("stroke", "", () => this.darkMode ? "#9ca3af" : "#6b7280")
      ),
      // Suffixes (PK, FK, UQ, AI, NN)
      $(go.TextBlock,
        {
          font: "bold 10px Inter, system-ui, sans-serif",
          margin: new go.Margin(0, 0, 0, 2),
          maxSize: new go.Size(60, NaN),
          overflow: go.TextBlock.OverflowEllipsis
        },
        new go.Binding("text", "", getAttributeSuffix),
        new go.Binding("stroke", "", getAttributeIconColor)
      )
    );

    this.diagram.nodeTemplate =
      $(go.Node, "Auto",
        {
          selectionAdorned: true,
          resizable: true,
          layoutConditions: go.Part.LayoutStandard & ~go.Part.LayoutNodeSized,
          fromSpot: go.Spot.AllSides,
          toSpot: go.Spot.AllSides,
          isShadowed: true,
          shadowOffset: new go.Point(2, 2),
          shadowColor: "rgba(0,0,0,0.2)",
          click: (e: go.InputEvent, node: go.GraphObject): void => {
            // @ts-ignore
            this.entityClicked(node.part.data);
          }
        },
        new go.Binding("location", "location").makeTwoWay(),
        $(go.Shape, "RoundedRectangle",
          {
            name: "MAIN_SHAPE",
            fill: "white",
            stroke: "#e5e7eb",
            strokeWidth: 1,
          },
          new go.Binding("fill", "", () => this.darkMode ? "#374151" : "white"),
          new go.Binding("stroke", "", () => this.darkMode ? "#4b5563" : "#e5e7eb")
        ),
        $(go.Panel, "Table",
          {
            defaultAlignment: go.Spot.Left,
            margin: 0,
            minSize: new go.Size(220, NaN)  // Minimum width for best layout
          },
          $(go.RowColumnDefinition, { row: 0, sizing: go.RowColumnDefinition.None }),
          $(go.RowColumnDefinition, { row: 1, sizing: go.RowColumnDefinition.None }),

          // Header
          $(go.Panel, "Horizontal",
            {
              row: 0,
              alignment: go.Spot.Center,
              stretch: go.GraphObject.Horizontal,
              background: "#f3f4f6",
              margin: new go.Margin(0, 0, 1, 0)  // Separador do header
            },
            new go.Binding("background", "", () => this.darkMode ? "#1f2937" : "#f3f4f6"),
            // Table icon
            $(go.TextBlock,
              {
                font: "16px Inter, system-ui, sans-serif",
                margin: new go.Margin(10, 6, 10, 10),
                text: "🗃️"
              }
            ),
            // Entity name
            $(go.TextBlock,
              {
                font: "600 18px Inter, system-ui, sans-serif",
                margin: new go.Margin(10, 4, 10, 0),
                maxSize: new go.Size(200, NaN),
                overflow: go.TextBlock.OverflowEllipsis
              },
              new go.Binding("text", "key"),
              new go.Binding("stroke", "", () => this.darkMode ? "#f3f4f6" : "#1f2937")
            ),
            // Lock indicator with user info
            $(go.Panel, "Horizontal",
              {
                name: "LOCK_INDICATOR",
                margin: new go.Margin(8, 8, 8, 4),
                background: "transparent"
              },
              new go.Binding("visible", "id", (entityId) => {
                return this.lockedEntities.some(lock => lock.entityId === entityId);
              }).ofObject(),
              // Lock icon
              $(go.TextBlock,
                {
                  font: "12px Inter, system-ui, sans-serif",
                  margin: new go.Margin(0, 2, 0, 0)
                },
                new go.Binding("text", "id", (entityId) => {
                  const isLockedByMe = this.collaborationService.isEntityLockedByCurrentUser(entityId);
                  return isLockedByMe ? "🔓" : "🔒";
                }).ofObject(),
                new go.Binding("stroke", "id", (entityId) => {
                  const isLockedByMe = this.collaborationService.isEntityLockedByCurrentUser(entityId);
                  return isLockedByMe ? "#10b981" : "#dc2626";
                }).ofObject()
              ),
              // User name
              $(go.TextBlock,
                {
                  font: "10px Inter, system-ui, sans-serif",
                  maxSize: new go.Size(80, NaN),
                  overflow: go.TextBlock.OverflowEllipsis
                },
                new go.Binding("text", "id", (entityId) => {
                  const lockInfo = this.lockedEntities.find(lock => lock.entityId === entityId);
                  if (!lockInfo) return "";

                  const isLockedByMe = this.collaborationService.isEntityLockedByCurrentUser(entityId);
                  const userName = isLockedByMe ? "You" : this.getFirstName(lockInfo.userName);
                  return userName;
                }).ofObject(),
                new go.Binding("stroke", "id", (entityId) => {
                  const isLockedByMe = this.collaborationService.isEntityLockedByCurrentUser(entityId);
                  return isLockedByMe ? "#10b981" : "#dc2626";
                }).ofObject()
              )
            )
          ),

          // Attributes list
          $(go.Panel, "Vertical",
            {
              name: "ATTRIBUTES",
              row: 1,
              margin: new go.Margin(8, 8, 8, 8),
              stretch: go.GraphObject.Horizontal,
              itemTemplate: itemTemplate,
              defaultAlignment: go.Spot.Left
            },
            new go.Binding("itemArray", "items")
          )
        )
      );

    this.diagram.linkTemplate =
      $(go.Link,
        {
          routing: go.Link.AvoidsNodes,
          curve: go.Link.JumpOver,
          corner: 10,
          selectionAdorned: true,
          fromEndSegmentLength: 50,
          toEndSegmentLength: 50,
        },
        $(go.Shape,
          {
            stroke: "#6b7280",
            strokeWidth: 2,
          },
          new go.Binding("stroke", "", () => this.darkMode ? "#4b5563" : "#6b7280")
        ),
        $(go.Shape,
          { toArrow: "Standard", stroke: null },
          new go.Binding("fill", "", () => this.darkMode ? "#4b5563" : "#6b7280")
        ),
        $(go.Panel, "Auto",
          {
            segmentOffset: new go.Point(0, -12)
          },
          $(go.Shape, "RoundedRectangle",
            {
              fill: this.darkMode ? "#374151" : "white",
              stroke: this.darkMode ? "#4b5563" : "#e5e7eb"
            }
          ),
          $(go.TextBlock,
            {
              text: "1",
              font: "600 12px Inter, system-ui, sans-serif",
              margin: 3
            },
            new go.Binding("text", "text"),
            new go.Binding("stroke", "", () => this.darkMode ? "#f3f4f6" : "#1f2937")
          )
        ),
        $(go.Panel, "Auto",
          {
            segmentOffset: new go.Point(0, -12),
            segmentIndex: -1
          },
          $(go.Shape, "RoundedRectangle",
            {
              fill: this.darkMode ? "#374151" : "white",
              stroke: this.darkMode ? "#4b5563" : "#e5e7eb"
            }
          ),
          $(go.TextBlock,
            {
              font: "600 12px Inter, system-ui, sans-serif",
              margin: 3
            },
            new go.Binding("text", "toText"),
            new go.Binding("stroke", "", () => this.darkMode ? "#f3f4f6" : "#1f2937")
          )
        )
      );

    this.diagram.nodeTemplate.doubleClick = (e: go.InputEvent, node: go.GraphObject): void => {
      // @ts-ignore
      const clickedNode = node.part.data;
      this.showTableEditorModal(clickedNode);
    }

    // Event listener for pressing the delete key
    this.diagram.commandHandler.deleteSelection = () : void => {
      let selection: go.Set<go.Part> = this.diagram.selection;

      selection.each((part: go.Part): void => {
        if (part instanceof go.Node) {
          this.handleRemove(part.data.id);
        } else if (part instanceof go.Link) {
          this.removeRelationship(part.data.id);
        } else {
          return;
        }
      });

      go.CommandHandler.prototype.deleteSelection.call(this.diagram.commandHandler);
    };
  }

  toggleDarkMode(): void {
    this.darkMode = !this.darkMode;
  }

  addEntity(): void {
    // Check if the user can edit the diagram
    if (!this.canEdit) {
      this.showPermissionDeniedMessage();
      return;
    }

    // Validate before adding new entity if there are many errors
    if (!this.validateNewEntity()) {
      return; // Do not add if user chose to view report
    }

    const newEntity: EntityModel = {
      id: crypto.randomUUID(),
      key: `table${this.entities.length + 1}`,
      items: [],
      location: new go.Point(Math.random() * 400, Math.random() * 400)
    };

    this.entities.push(newEntity);
    this.diagram.model = new go.GraphLinksModel({
      nodeDataArray: this.entities,
      linkDataArray: this.relationships
    });
  }

  // Entity editor
  showTableEditorModal(entity: any): void {
    // Verificar se o usuário pode editar
    if (!this.canEdit) {
      this.showPermissionDeniedMessage();
      return;
    }

    // Check if the entity is not being edited by another user
    const conflict = this.collaborationService.checkEditConflict(entity.id);
    if (!conflict.canEdit) {
      const lockInfo = this.lockedEntities.find(lock => lock.entityId === entity.id);
      let detailedMessage = conflict.message;

      if (lockInfo) {
        const lockTime = new Date(lockInfo.lockedAt).toLocaleString();
        detailedMessage += `\n\n📊 Entity: ${entity.key}\n👤 Being edited by: ${lockInfo.userName}\n⏰ Locked since: ${lockTime}\n\n💡 You can see the lock indicator (🔒) on the entity. Try again later when it's unlocked.`;
      }

      alert(detailedMessage);
      return;
    }

    // Try to lock the entity for editing
    this.collaborationService.lockEntity(entity.id, this.projectId).subscribe({
      next: (lock: EntityLock) => {
        console.log('Entity locked successfully:', lock);
        this.selectedEntity = entity;
        this.openEntityEditorModal();
      },
      error: (error: any) => {
        console.error('Error locking entity:', error);
        this.handleLockFailure(entity);
      }
    });
  }

  handleSave(entity: any): void {
    // Validate entity before saving
    const validationResult = this.sqlValidationService.validateEntity(entity, this.entities);

    if (!validationResult.isValid) {
      const message = this.sqlValidationService.formatValidationMessages(validationResult);
      alert(message);
      return; // Do not save if there are errors
    }

    // Show warnings if any (but allow to continue)
    if (validationResult.warnings.length > 0) {
      const warningMessage = `⚠️ WARNINGS:\n${validationResult.warnings.join('\n')}\n\nDo you want to continue anyway?`;
      if (!confirm(warningMessage)) {
        return;
      }
    }

    this.showTableEditor = false;
    const index: number = this.entities.findIndex((e: EntityModel) : boolean => e.id === entity.id);

    const oldKey: string = this.entities[index].key;
    const newKey = entity.key;

    this.entities[index] = entity;

    this.relationships.forEach((relationship): void => {
      if (relationship.from === oldKey) {
        relationship.from = newKey;
      }
      if (relationship.to === oldKey) {
        relationship.to = newKey;
      }
    });

    this.diagram.model = new go.GraphLinksModel( {
      nodeDataArray: this.entities,
      linkDataArray: this.relationships
    });

    // Validate the complete diagram after update
    this.validateDiagram();
  }

  handleRemove(id: string): void {
    this.showTableEditor = false;
    const removedEntity: EntityModel | undefined = this.entities.find((e: EntityModel) : boolean => e.id === id);

    if (removedEntity) {
      this.entities.forEach((entity: EntityModel) : void => {
        const fkIndex: number = entity.items.findIndex((item: AttributeModel) : boolean => item.name === `${removedEntity.key}_id`);
        if (fkIndex !== -1) {
          entity.items.splice(fkIndex, 1);
        }
      });
    }

    this.entities = this.entities.filter((e: EntityModel) : boolean => e.id !== id);
    this.relationships = this.relationships.filter(r => r.from !== id && r.to !== id);
    this.diagram.model = new go.GraphLinksModel({
      nodeDataArray: this.entities,
      linkDataArray: this.relationships
    });
  }

  handleClose(): void {
    this.showTableEditor = false;
  }

  selectRelationshipType(type: '1:1' | '1:N' | 'N:N'): void {
    // Check if the user can edit the diagram
    if (!this.canEdit) {
      this.showPermissionDeniedMessage();
      return;
    }

    this.selectedRelationshipType = type;
    this.selectedEntities = [];
  }

  entityClicked(entity: any): void {
    const hasPrimaryKey: boolean = entity.items.some((item: AttributeModel) : boolean => item.pk);
    if (!hasPrimaryKey) {
      console.log(`Entity ${entity.key} does not have a primary key and cannot be part of a relationship.`);
      return;
    }

    if (this.selectedRelationshipType && this.selectedEntities.length < 2) {
      this.selectedEntities.push(entity);
    }

    if (this.selectedEntities.length === 2) {
      if (this.selectedRelationshipType === 'N:N') {
        const firstForeignKey: AttributeModel = {
          name: `${this.selectedEntities[0].key}_id`,
          // @ts-ignore
          type: this.selectedEntities[0].items.filter(item => item.pk)[0].type,
          pk: false,
          fk: true,
          unique: false,
          defaultValue: '',
          nullable: false,
          autoIncrement: false
        };

        const secondForeignKey: AttributeModel = {
          name: `${this.selectedEntities[1].key}_id`,
          // @ts-ignore
          type: this.selectedEntities[1].items.filter(item => item.pk)[0].type,
          pk: false,
          fk: true,
          unique: false,
          defaultValue: '',
          nullable: false,
          autoIncrement: false
        };

        const newIntermediaryEntity: IntermediaryEntityModel = {
          id: crypto.randomUUID(),
          key: `${this.selectedEntities[0].key}_${this.selectedEntities[1].key}`,
          items: [firstForeignKey, secondForeignKey],
          location: new go.Point(Math.random() * 400, Math.random() * 400),
          firstEntityId: this.selectedEntities[0].key,
          secondEntityId: this.selectedEntities[1].key
        };

        this.entities.push(newIntermediaryEntity);

        const firstLinkData: LinkDataModel = {
          id: crypto.randomUUID(),
          from: this.selectedEntities[0].key,
          to: newIntermediaryEntity.key,
          text: '1:N',
          toText: 1,
        };

        const secondLinkData: LinkDataModel = {
          id: crypto.randomUUID(),
          from: newIntermediaryEntity.key,
          to: this.selectedEntities[1].key,
          text: '1:N',
          toText: 1,
        };

        this.createRelationship(firstLinkData);
        this.createRelationship(secondLinkData);

        this.remakeDiagram();
      } else {
        const foreignKeyAttribute: AttributeModel = {
          name: `${this.selectedEntities[1].key}_id`,
          // @ts-ignore
          type: this.selectedEntities[1].items.filter(item => item.pk)[0].type,
          pk: false,
          fk: true,
          unique: false,
          defaultValue: '',
          nullable: false,
          autoIncrement: false
        };

        this.selectedEntities[0].items.push(foreignKeyAttribute);

        const linkData: LinkDataModel = {
          id: crypto.randomUUID(),
          from: this.selectedEntities[0].key,
          to: this.selectedEntities[1].key,
          text: this.selectedRelationshipType,
          toText: 1,
        };

        this.createRelationship(linkData);
      }

      this.selectedRelationshipType = null;
    }
  }

  createRelationship(linkData: any): void {
    this.relationships.push(linkData);
    this.remakeDiagram();
    this.selectedEntities = [];
  }

  removeRelationship(id: string): void {
    let relationshipToRemove: any = {};
    const index: number = this.relationships.findIndex(r => r.id === id);

    if (index !== -1) {
      relationshipToRemove = this.relationships.splice(index, 1)[0];
    }

    if (relationshipToRemove.text === '1:1' || relationshipToRemove.text === '1:N') {
      const entity: EntityModel | undefined = this.entities.find((e: EntityModel) : boolean => e.key === relationshipToRemove.from);
      if (entity) {
        const fkIndex: number = entity.items.findIndex((item: AttributeModel) : boolean => item.name === `${relationshipToRemove.to}_id`);
        if (fkIndex !== -1) {
          entity.items.splice(fkIndex, 1);
        }
      }
    }

    this.remakeDiagram();
  }

  remakeDiagram(): void {
    if (!this.diagram) {
      this.initializeDiagram();
    }

    try {
      this.entities.forEach((entity: EntityModel, index: number): void => {
        if (this.locations[index]) {
          entity.location = this.locations[index];
        } else {
          entity.location = new go.Point(Math.random() * 400, Math.random() * 400);
        }
      });

      this.diagram.model = new go.GraphLinksModel({
        nodeDataArray: this.entities,
        linkDataArray: this.relationships
      });
    } catch (error) {
      console.error('Error remaking diagram:', error);
    }
  }

  receiveMessageAndRemakeDiagram(message: any): void {
    const data = JSON.parse(message.body);
    this.locations = data.nodeDataArray.map((entity: EntityModel) => {
      return new go.Point(Number(entity.location.x), Number(entity.location.y));
    });
    this.entities = data.nodeDataArray;
    this.relationships = data.linkDataArray;
    this.remakeDiagram();
  }

  // Entity editor modal
  openEntityEditorModal(): void {
    this.isEntityEditorModalOpen = true;
    console.log(this.isEntityEditorModalOpen);
  }

  closeEntityEditorModal(): void {
    // Unlock entity when closing modal
    if (this.selectedEntity && this.selectedEntity.id) {
      this.collaborationService.unlockEntity(this.selectedEntity.id, this.projectId).subscribe({
        next: () => {
          console.log('Entity unlocked successfully');
        },
        error: (error: any) => {
          console.error('Error unlocking entity:', error);
        }
      });
    }

    this.isEntityEditorModalOpen = false;
    this.selectedEntity = {};
  }

  sendToServer(): void {
    const message: string = JSON.stringify({
      nodeDataArray: this.entities,
      linkDataArray: this.relationships,
      projectId: this.projectId,
      darkMode: this.darkMode
    });

    if (this.stompClient && this.stompClient.connected) {
      this.stompClient.publish({
        destination: '/app/send',
        body: message
      });
    } else {
      console.log('Cannot send message, stompClient is not connected');
    }
  }

  exportDdl(): void {
    if (!this.projectId) {
      console.error('No project selected for export');
      return;
    }

    this.ddlService.exportDdl(this.projectId).subscribe({
      next: (response) => {
        const filename = `${this.projectId}_diagram.sql`;
        this.ddlService.downloadSqlFile(response.ddlContent, filename);
        console.log('DDL exported successfully');
      },
      error: (error) => {
        console.error('Error exporting DDL:', error);
        alert('Error exporting DDL. Please try again.');
      }
    });
  }

  importDdl(): void {
    if (!this.projectId) {
      console.error('No project selected for import');
      return;
    }

    // Trigger file input click
    if (this.fileInput) {
      this.fileInput.nativeElement.click();
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith('.sql')) {
      alert('Please select a valid SQL file.');
      return;
    }

    this.ddlService.readSqlFile(file).then((ddlContent) => {
      const importRequest = {
        projectId: this.projectId,
        ddlContent: ddlContent
      };

      this.ddlService.importDdl(importRequest).subscribe({
        next: () => {
          console.log('DDL imported successfully');
          alert('DDL imported successfully! Reloading diagram...');
          // Reload the diagram data
          this.loadDiagramData(this.projectId);
        },
        error: (error) => {
          console.error('Error importing DDL:', error);
          alert('Error importing DDL. Please check the file format and try again.');
        }
      });
    }).catch((error) => {
      console.error('Error reading file:', error);
      alert('Error reading file. Please try again.');
    });

    // Reset file input
    input.value = '';
  }

  private showPermissionDeniedMessage(): void {
    const roleMessage = this.userRole === 'VIEWER'
      ? 'You have view-only access to this diagram. Contact the project owner for edit permissions.'
      : 'You do not have permission to edit this diagram.';

    alert(roleMessage);
  }

  // Helper methods for the template
  getRoleIcon(): string {
    switch (this.userRole) {
      case 'OWNER': return 'bi-crown';
      case 'EDITOR': return 'bi-pencil';
      case 'VIEWER': return 'bi-eye';
      default: return 'bi-person';
    }
  }

  getUserRoleDisplay(): string {
    switch (this.userRole) {
      case 'OWNER': return 'Owner';
      case 'EDITOR': return 'Editor';
      case 'VIEWER': return 'Viewer';
      default: return 'No Access';
    }
  }

  getFirstName(fullName: string): string {
    if (!fullName) return 'User';
    const parts = fullName.split(' ');
    return parts[0] || 'User';
  }

  getEntityName(entityId: string): string {
    const entity = this.entities.find(e => e.id === entityId);
    return entity?.key || 'Unknown Entity';
  }

  private refreshDiagramBindings(): void {
    if (!this.diagram) return;

    try {
      // Force update of GoJS bindings
      this.diagram.nodes.each((node: go.Node) => {
        // Update lock indicator specific bindings
        const lockIndicator = node.findObject('LOCK_INDICATOR');
        if (lockIndicator) {
          // Force update of bindings
          node.updateTargetBindings();
        }
      });

      // Invalidate the diagram to force re-render
      this.diagram.invalidateDocumentBounds();
    } catch (error) {
      console.error('Error refreshing diagram bindings:', error);
    }
  }

  private handleLockFailure(entity: any): void {
    const message = `❌ Failed to lock entity for editing.\n\nThis might happen if:\n• Another user just started editing it\n• There are stale locks in the system\n• Network connection issues\n\nWould you like to try cleaning up stale locks and retry?`;

    if (confirm(message)) {
      // Try clearing orphaned locks and try again
      this.collaborationService.forceCleanupStaleLocks().subscribe({
        next: () => {
          console.log('Stale locks cleaned up');
          // Reload project locks
          this.loadProjectLocks(this.projectId);

          // Try again after a short delay
          setTimeout(() => {
            this.retryEntityLock(entity);
          }, 500);
        },
        error: (error: any) => {
          console.error('Error cleaning up stale locks:', error);
          alert('❌ Failed to clean up stale locks. Please try again later or contact support.');
        }
      });
    }
  }

  private retryEntityLock(entity: any): void {
    this.collaborationService.lockEntity(entity.id, this.projectId).subscribe({
      next: (lock: EntityLock) => {
        console.log('Entity locked successfully on retry:', lock);
        this.selectedEntity = entity;
        this.openEntityEditorModal();
      },
      error: (error: any) => {
        console.error('Error locking entity on retry:', error);
        alert('❌ Still unable to lock entity for editing. Please try again later.');
      }
    });
  }

  // Complete diagram validation
  validateDiagram(): void {
    const validationResult: ValidationResult = this.sqlValidationService.validateDiagram(this.entities);

    // Update visual validation status
    this.updateValidationStatus(validationResult);

    // Log for debugging (optional)
    if (!validationResult.isValid) {
      console.warn('Diagram validation errors:', validationResult.errors);
    }

    if (validationResult.warnings.length > 0) {
      console.info('Diagram validation warnings:', validationResult.warnings);
    }
  }

  // Update visual diagram status based on validation
  private updateValidationStatus(validationResult: ValidationResult): void {
    this.entities.forEach(entity => {
      const node = this.diagram.findNodeForKey(entity.id);
      if (node) {
        const entityValidation = this.sqlValidationService.validateEntity(entity, this.entities);

        // Apply visual styles based on validation
        const mainShapeObj = node.findObject('MAIN_SHAPE');
        const mainShape = mainShapeObj as go.Shape;

        if (mainShape && mainShape instanceof go.Shape) {
          if (!entityValidation.isValid) {
            // Entity with errors - red border
            mainShape.stroke = '#dc2626';
            mainShape.strokeWidth = 2;
          } else if (entityValidation.warnings.length > 0) {
            // Entity with warnings - orange border
            mainShape.stroke = '#f59e0b';
            mainShape.strokeWidth = 2;
          } else {
            // Valid Entity - Default Edge
            mainShape.stroke = '#6b7280';
            mainShape.strokeWidth = 1;
          }
        }
      }
    });
  }

  // Method to show validations in a modal
  showValidationReport(): void {
    const validationResult: ValidationResult = this.sqlValidationService.validateDiagram(this.entities);

    if (validationResult.errors.length === 0 && validationResult.warnings.length === 0) {
      alert('✅ Diagram is valid! No errors or warnings found.');
      return;
    }

    const message = this.sqlValidationService.formatValidationMessages(validationResult);
    alert(message);
  }

  // Automatic validation when adding new entity
  validateNewEntity(): boolean {
    if (this.entities.length === 0) return true;

    const validationResult = this.sqlValidationService.validateDiagram(this.entities);

    // If there are many entities without validation, warn
    const invalidEntities = this.entities.filter(entity => {
      const entityValidation = this.sqlValidationService.validateEntity(entity, this.entities);
      return !entityValidation.isValid;
    });

    if (invalidEntities.length > 3) {
      const proceed = confirm(
        `⚠️ You have ${invalidEntities.length} entities with validation errors.\n\n` +
        'Adding more entities without fixing existing issues might create more problems.\n\n' +
        'Do you want to see the validation report first?'
      );

      if (proceed) {
        this.showValidationReport();
        return false;
      }
    }

    return true;
  }

}
