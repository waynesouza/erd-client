import { Component, Input, OnDestroy, OnInit, ViewChild, ElementRef } from '@angular/core';
import * as go from 'gojs';
import { Client } from '@stomp/stompjs';
import { DiagramRendererService, DiagramRenderHost, LockVisual } from './diagram-renderer.service';
import { StompClientFactory } from './stomp-client.factory';
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
import { environment } from '../../environments/environment';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

@Component({
  selector: 'app-diagram',
  templateUrl: './diagram.component.html',
  styleUrls: ['./diagram.component.css']
})
export class DiagramComponent implements OnInit, OnDestroy, DiagramRenderHost {

  @Input() entities: EntityModel[] = [];
  @Input() selectedProjectId: string = '';
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('diagramDiv') diagramDiv?: ElementRef<HTMLDivElement>;
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
  private stompSubscriptions: any[] = [];
  private changeSubject = new Subject<void>();
  private autoSaveSubscription!: Subscription;
  // Subscriptions to root-provided services: they outlive this component unless
  // torn down here, and a leaked one keeps a destroyed instance rebuilding the
  // diagram over the live instance's div.
  private serviceSubscriptions = new Subscription();
  private isUpdatingFromServer = false;

  constructor(
    private diagramService: DiagramService,
    private sharedService: SharedService,
    private ddlService: DdlService,
    private collaborationService: CollaborationService,
    private projectService: ProjectService,
    private storageService: StorageService,
    private diagramRenderer: DiagramRendererService,
    private stompClientFactory: StompClientFactory
  ) {
    this.currentUser = this.storageService.getUser();
  }

  ngOnInit(): void {
    // WebSocket configuration using @stomp/stompjs
    this.stompClient = this.stompClientFactory.create(environment.wsUrl);

    this.stompClient.onConnect = (frame: any) => {
      console.log('Connected: ' + frame);
      if (this.projectId) {
        this.subscribeToProjectTopics(this.projectId);
      }
    };

    this.stompClient.onStompError = (frame: any) => {
      console.error('Broker reported error: ' + frame.headers['message']);
      console.error('Additional details: ' + frame.body);
    };

    this.stompClient.activate();

    // Monitor project changes and load data with permissions
    this.serviceSubscriptions.add(this.sharedService.currentProjectId.subscribe((projectId: any) => {
      if (projectId) {
        this.projectId = projectId;
        this.loadProjectData(projectId);
        this.loadDiagramData(projectId);
        if (this.stompClient && this.stompClient.connected) {
          this.subscribeToProjectTopics(projectId);
        }
      } else {
        this.clearProjectData();
      }
    }));

    // Monitor entity locks and update diagram in real time
    this.serviceSubscriptions.add(this.collaborationService.lockedEntities$.subscribe((locks: EntityLock[]) => {
      console.log('Locks updated via WebSocket:', locks);
      this.lockedEntities = locks;
      // Update diagram immediately when locks change
      setTimeout(() => {
        this.updateDiagramLockStates();
        this.refreshDiagramBindings();
      }, 100);
    }));

    this.autoSaveSubscription = this.changeSubject.pipe(
      debounceTime(1500)
    ).subscribe(() => this.sendToServer());
  }

  private subscribeToProjectTopics(projectId: string): void {
    this.stompSubscriptions.forEach(sub => sub.unsubscribe());
    this.stompSubscriptions = [];

    const diagramSub = this.stompClient.subscribe(
      `/topic/diagram/${projectId}`,
      (message: any) => {
        console.log('Received diagram update:', message);
        this.receiveMessageAndRemakeDiagram(message);
      }
    );

    const collabSub = this.stompClient.subscribe(
      `/topic/collaboration/${projectId}`,
      (message: any) => {
        const collaborationMessage: CollaborationMessage = JSON.parse(message.body);
        this.collaborationService.processCollaborationMessage(collaborationMessage);
      }
    );

    this.stompSubscriptions.push(diagramSub, collabSub);
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

    this.diagramRenderer.applyLockStyling(this.diagram, this);
  }

  /**
   * Decides how one entity should look given its lock state. Pure - the
   * renderer only copies these values onto GoJS objects.
   */
  resolveLockVisual(entityId: string): LockVisual {
    const isLocked = this.collaborationService.isEntityLockedByOtherUser(entityId);
    const isLockedByMe = this.collaborationService.isEntityLockedByCurrentUser(entityId);
    const lockInfo = this.lockedEntities.find(lock => lock.entityId === entityId);

    if (isLocked && lockInfo) {
      // Entity locked by another user - locked look
      return {
        opacity: 0.7,
        stroke: '#dc2626', // Red for blocked
        strokeWidth: 3,
        dash: [8, 4], // Dotted line
        cursor: 'not-allowed',
        tooltipText: this.buildLockTooltipText(lockInfo, false),
        isOwnLock: false
      };
    }

    if (isLockedByMe && lockInfo) {
      // Entity locked by current user - edit view
      return {
        opacity: 1.0,
        stroke: '#10b981', // Green for editing
        strokeWidth: 3,
        dash: null, // Solid line
        cursor: 'pointer',
        tooltipText: this.buildLockTooltipText(lockInfo, true),
        isOwnLock: true
      };
    }

    // Available entity
    return {
      opacity: 1.0,
      stroke: this.darkMode ? '#4b5563' : '#e5e7eb',
      strokeWidth: 1,
      dash: null,
      cursor: 'pointer',
      tooltipText: null,
      isOwnLock: false
    };
  }

  buildLockTooltipText(lockInfo: EntityLock, isOwnLock: boolean): string {
    return isOwnLock
      ? `🔓 You are editing this entity\nLocked at: ${new Date(lockInfo.lockedAt).toLocaleString()}`
      : `🔒 Being edited by: ${lockInfo.userName}\nLocked at: ${new Date(lockInfo.lockedAt).toLocaleString()}`;
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
    this.isUpdatingFromServer = true;
    this.initializeDiagram();
    if (this.entities.length > 0 || this.relationships.length > 0) {
      this.remakeDiagram();
    }
    this.isUpdatingFromServer = false;
  }

  private setupEmptyDiagram(): void {
    this.entities = [];
    this.relationships = [];
    this.locations = [];
    this.initializeDiagram();
  }

  ngOnDestroy(): void {
    this.serviceSubscriptions.unsubscribe();
    this.autoSaveSubscription?.unsubscribe();
    this.changeSubject.complete();
    this.stompSubscriptions.forEach(sub => sub.unsubscribe());
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

    // This instance's own div, never whatever `myDiagramDiv` resolves to in the
    // document: a stale instance would otherwise build its diagram on the live
    // one's element.
    const div = this.diagramDiv?.nativeElement ?? document.getElementById('myDiagramDiv');
    if (!div) {
      console.error('Cannot initialize diagram: #myDiagramDiv is not in the DOM');
      return;
    }

    // GoJS refuses a div that still has a Diagram attached, so release it first.
    const attached = go.Diagram.fromDiv(div);
    if (attached) {
      attached.div = null;
    }

    this.diagram = this.diagramRenderer.create(div as HTMLDivElement, this);
    this.diagram.model = new go.GraphLinksModel({nodeDataArray: this.entities});
  }

  // ---------------------------------------------------------------------------
  // Values consumed by the GoJS templates (DiagramRenderHost).
  // Each is a pure function of component state so that the presentation rules
  // stay unit-testable while only the GoJS wiring lives in the renderer.
  // ---------------------------------------------------------------------------

  getDataTypeColor(dataType: string): string {
    const colorMap: { [key: string]: string } = {
      'INTEGER': '#3b82f6', 'BIGINT': '#3b82f6', 'DECIMAL': '#3b82f6', 'NUMERIC': '#3b82f6',
      'VARCHAR': '#10b981', 'CHAR': '#10b981', 'TEXT': '#10b981',
      'BOOLEAN': '#8b5cf6',
      'DATE': '#f59e0b', 'DATETIME': '#f59e0b', 'TIMESTAMP': '#f59e0b', 'TIME': '#f59e0b',
      'UUID': '#6b7280'
    };
    return colorMap[dataType] || '#9ca3af';
  }

  buildAttributeTooltip(attribute: any): string {
    const constraints = [];
    if (attribute.pk) constraints.push('Primary Key');
    if (attribute.fk) constraints.push('Foreign Key');
    if (attribute.unique && !attribute.pk) constraints.push('Unique');
    if (attribute.autoIncrement) constraints.push('Auto Increment');
    if (!attribute.nullable) constraints.push('Not Null');

    const constraintText = constraints.length > 0 ? constraints.join(', ') : 'No constraints';
    return `${attribute.name}\nType: ${attribute.type}\nConstraints: ${constraintText}`;
  }

  getAttributeFont(pk: boolean): string {
    return pk ? "bold 14px Inter, system-ui, sans-serif" : "14px Inter, system-ui, sans-serif";
  }

  getPkLabel(pk: boolean): string {
    return pk ? "PK" : "";
  }

  getPrimaryTextStroke(): string {
    return this.darkMode ? "#f3f4f6" : "#1f2937";
  }

  getSecondaryTextStroke(): string {
    return this.darkMode ? "#9ca3af" : "#6b7280";
  }

  getNodeFill(): string {
    return this.darkMode ? "#374151" : "white";
  }

  getNodeStroke(): string {
    return this.darkMode ? "#4b5563" : "#e5e7eb";
  }

  getHeaderBackground(): string {
    return this.darkMode ? "#1f2937" : "#f3f4f6";
  }

  getLinkStroke(): string {
    return this.darkMode ? "#4b5563" : "#6b7280";
  }

  isEntityLocked(entityId: string): boolean {
    return this.lockedEntities.some(lock => lock.entityId === entityId);
  }

  getLockIcon(entityId: string): string {
    return this.collaborationService.isEntityLockedByCurrentUser(entityId) ? "🔓" : "🔒";
  }

  getLockStrokeColor(entityId: string): string {
    return this.collaborationService.isEntityLockedByCurrentUser(entityId) ? "#10b981" : "#dc2626";
  }

  getLockUserLabel(entityId: string): string {
    const lockInfo = this.lockedEntities.find(lock => lock.entityId === entityId);
    if (!lockInfo) return "";

    const isLockedByMe = this.collaborationService.isEntityLockedByCurrentUser(entityId);
    return isLockedByMe ? "You" : this.getFirstName(lockInfo.userName);
  }

  onDiagramModified(): void {
    if (!this.isUpdatingFromServer && this.projectId) {
      this.changeSubject.next();
      this.diagram.isModified = false;
    }
  }

  toggleDarkMode(): void {
    this.darkMode = !this.darkMode;
  }

  addEntity(): void {
    if (!this.canEdit) {
      this.showPermissionDeniedMessage();
      return;
    }

    if (!this.diagram) {
      this.initializeDiagram();
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
    // Guard: user must have edit permission
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

    // If clicking the same type, deselect it
    if (this.selectedRelationshipType === type) {
      this.cancelRelationshipSelection();
      return;
    }

    this.selectedRelationshipType = type;
    this.selectedEntities = [];

    // Show user feedback
    console.log(`Relationship type '${type}' selected. Click on two tables to create relationship.`);
  }

  cancelRelationshipSelection(): void {
    this.selectedRelationshipType = null;
    this.selectedEntities = [];
    console.log('Relationship selection cancelled.');
  }

  // Improved entity click handler with better feedback
  entityClicked(entity: any): void {
    if (!this.selectedRelationshipType) {
      return;
    }

    const hasPrimaryKey: boolean = entity.items.some((item: AttributeModel) : boolean => item.pk);
    if (!hasPrimaryKey) {
      console.warn(`Entity '${entity.key}' does not have a primary key and cannot be part of a relationship.`);
      // Show user-friendly message
      this.showEntityValidationMessage(entity.key, 'This table needs a primary key to create relationships.');
      return;
    }

    // Check if entity is already selected
    if (this.selectedEntities.find(e => e.key === entity.key)) {
      console.log(`Entity '${entity.key}' is already selected for this relationship.`);
      return;
    }

    if (this.selectedRelationshipType && this.selectedEntities.length < 2) {
      this.selectedEntities.push(entity);
      console.log(`Selected entity '${entity.key}' for ${this.selectedRelationshipType} relationship (${this.selectedEntities.length}/2)`);
    }

    if (this.selectedEntities.length === 2) {
      this.createRelationshipFromSelection();
    }
  }

  private createRelationshipFromSelection(): void {
    if (!this.selectedRelationshipType || this.selectedEntities.length !== 2) {
      return;
    }

    const relationshipType = this.selectedRelationshipType;
    const sourceEntity = this.selectedEntities[0];
    const targetEntity = this.selectedEntities[1];

    console.log(`Creating ${relationshipType} relationship between '${sourceEntity.key}' and '${targetEntity.key}'`);

    if (relationshipType === 'N:N') {
      this.createManyToManyRelationship(sourceEntity, targetEntity);
    } else {
      this.createOneToOneOrOneToManyRelationship(sourceEntity, targetEntity, relationshipType);
    }

    // Reset selection
    this.cancelRelationshipSelection();
  }

  private createManyToManyRelationship(sourceEntity: any, targetEntity: any): void {
    const firstForeignKey: AttributeModel = {
      name: `${sourceEntity.key}_id`,
      // @ts-ignore
      type: sourceEntity.items.filter(item => item.pk)[0].type,
      pk: false,
      fk: true,
      unique: false,
      defaultValue: '',
      nullable: false,
      autoIncrement: false
    };

    const secondForeignKey: AttributeModel = {
      name: `${targetEntity.key}_id`,
      // @ts-ignore
      type: targetEntity.items.filter(item => item.pk)[0].type,
      pk: false,
      fk: true,
      unique: false,
      defaultValue: '',
      nullable: false,
      autoIncrement: false
    };

    const newIntermediaryEntity: IntermediaryEntityModel = {
      id: crypto.randomUUID(),
      key: `${sourceEntity.key}_${targetEntity.key}`,
      items: [firstForeignKey, secondForeignKey],
      location: new go.Point(Math.random() * 400, Math.random() * 400),
      firstEntityId: sourceEntity.key,
      secondEntityId: targetEntity.key
    };

    this.entities.push(newIntermediaryEntity);

    const firstLinkData: LinkDataModel = {
      id: crypto.randomUUID(),
      from: sourceEntity.key,
      to: newIntermediaryEntity.key,
      text: '1:N',
      toText: 1,
    };

    const secondLinkData: LinkDataModel = {
      id: crypto.randomUUID(),
      from: newIntermediaryEntity.key,
      to: targetEntity.key,
      text: '1:N',
      toText: 1,
    };

    this.createRelationship(firstLinkData);
    this.createRelationship(secondLinkData);
    this.remakeDiagram();
  }

  private createOneToOneOrOneToManyRelationship(sourceEntity: any, targetEntity: any, relationshipType: '1:1' | '1:N'): void {
    const foreignKeyAttribute: AttributeModel = {
      name: `${targetEntity.key}_id`,
      // @ts-ignore
      type: targetEntity.items.filter(item => item.pk)[0].type,
      pk: false,
      fk: true,
      unique: relationshipType === '1:1', // Unique constraint for 1:1 relationships
      defaultValue: '',
      nullable: false,
      autoIncrement: false
    };

    sourceEntity.items.push(foreignKeyAttribute);

    const linkData: LinkDataModel = {
      id: crypto.randomUUID(),
      from: sourceEntity.key,
      to: targetEntity.key,
      text: relationshipType,
      toText: 1,
    };

    this.createRelationship(linkData);
  }

  private showEntityValidationMessage(entityKey: string, message: string): void {
    // This could be replaced with a more sophisticated notification system
    alert(`Entity '${entityKey}': ${message}`);
  }

  createRelationship(linkData: any): void {
    this.relationships.push(linkData);
    this.remakeDiagram();
    this.selectedEntities = [];
  }

  /**
   * Remove a relationship and all its dependencies (FKs and intermediary entities)
   * @param id - ID of the relationship to be removed
   */
  removeRelationship(id: string): void {
    console.log(`Removing relationship: ${id}`);

    const relationshipIndex: number = this.relationships.findIndex(r => r.id === id);
    if (relationshipIndex === -1) {
      console.warn(`Relationship with ID ${id} not found`);
      return;
    }

    const relationshipToRemove = this.relationships[relationshipIndex];
    console.log(`Relationship found:`, relationshipToRemove);

    // Remove the relationship from the list
    this.relationships.splice(relationshipIndex, 1);

    // Process the removal based on the relationship type
    this.processRelationshipRemoval(relationshipToRemove);

    // Clean up orphaned intermediary entities (for N:N relationships)
    this.cleanupOrphanedIntermediaryEntities();

    // Verify cleanup was successful
    this.verifyRelationshipRemoval(relationshipToRemove);

    // Update the diagram
    this.remakeDiagram();

    console.log(`✅ Relationship ${id} removed successfully`);
  }

  /**
   * Process the removal of a relationship based on its type
   * @param relationship - Relationship to be processed
   */
  private processRelationshipRemoval(relationship: any): void {
    const relationshipType = relationship.text;

    switch (relationshipType) {
      case '1:1':
        this.removeOneToOneRelationship(relationship);
        break;
      case '1:N':
        this.removeOneToManyRelationship(relationship);
        break;
      case 'N:1':
        this.removeManyToOneRelationship(relationship);
        break;
      case 'N:N':
        this.removeManyToManyRelationship(relationship);
        break;
      default:
        console.warn(`⚠️ Unknown relationship type: ${relationshipType}`);
    }
  }

  /**
   * Remove foreign key of 1:1 relationship
   * @param relationship - 1:1 relationship to be removed
   */
  private removeOneToOneRelationship(relationship: any): void {
    console.log(`🔗 Removing 1:1 relationship between ${relationship.from} and ${relationship.to}`);

    // In 1:1 relationships, FK can be in either entity - check both directions
    const fromEntity = this.findEntityByKey(relationship.from);
    const toEntity = this.findEntityByKey(relationship.to);

    if (!fromEntity) {
      console.error(`❌ From entity not found: ${relationship.from}`);
      return;
    }

    if (!toEntity) {
      console.error(`❌ To entity not found: ${relationship.to}`);
      return;
    }

    // Try to remove FK from "from" entity that references "to" entity
    let fkRemoved = this.removeForeignKeyFromEntity(fromEntity, relationship.to);

    // If not found, try the reverse direction
    if (!fkRemoved) {
      fkRemoved = this.removeForeignKeyFromEntity(toEntity, relationship.from);
    }

    if (!fkRemoved) {
      console.warn(`⚠️ No FK found for 1:1 relationship between ${relationship.from} and ${relationship.to}`);
    }
  }

  /**
   * Remove foreign key of 1:N relationship
   * @param relationship - 1:N relationship to be removed
   */
  private removeOneToManyRelationship(relationship: any): void {
    console.log(`🔗 Removing 1:N relationship between ${relationship.from} and ${relationship.to}`);

    // In 1:N relationships, FK can be in either entity - check both directions
    const fromEntity = this.findEntityByKey(relationship.from);
    const toEntity = this.findEntityByKey(relationship.to);

    if (!fromEntity) {
      console.error(`❌ From entity not found: ${relationship.from}`);
      return;
    }

    if (!toEntity) {
      console.error(`❌ To entity not found: ${relationship.to}`);
      return;
    }

    // Try to remove FK from "from" entity that references "to" entity
    let fkRemoved = this.removeForeignKeyFromEntity(fromEntity, relationship.to);

    // If not found, try the reverse direction
    if (!fkRemoved) {
      fkRemoved = this.removeForeignKeyFromEntity(toEntity, relationship.from);
    }

    if (!fkRemoved) {
      console.warn(`⚠️ No FK found for 1:N relationship between ${relationship.from} and ${relationship.to}`);
    }
  }

  /**
   * Remove foreign key of N:1 relationship
   * @param relationship - N:1 relationship to be removed
   */
  private removeManyToOneRelationship(relationship: any): void {
    console.log(`🔗 Removing N:1 relationship between ${relationship.from} and ${relationship.to}`);

    // In N:1 relationships, the FK is always in the "from" entity (many side)
    const manyEntity = this.findEntityByKey(relationship.from);
    const oneEntity = this.findEntityByKey(relationship.to);

    if (!manyEntity) {
      console.error(`❌ Many entity not found: ${relationship.from}`);
      return;
    }

    if (!oneEntity) {
      console.error(`❌ One entity not found: ${relationship.to}`);
      return;
    }

    // Remove FK from "many" entity that references "one" entity
    console.log(`🔍 Looking for FK in ${manyEntity.key} that references ${oneEntity.key}`);

    // List all FKs in the many entity for debugging
    const allFKs = manyEntity.items.filter(item => item.fk === true);
    console.log(`📋 All FKs in ${manyEntity.key}:`, allFKs.map(fk => `${fk.name} (fk: ${fk.fk})`));

    const fkRemoved = this.removeForeignKeyFromEntity(manyEntity, relationship.to);

    if (!fkRemoved) {
      console.warn(`⚠️ No FK found for N:1 relationship between ${relationship.from} and ${relationship.to}`);
      // Try a more aggressive search
      console.log(`🔍 Trying aggressive FK search...`);
      for (let i = manyEntity.items.length - 1; i >= 0; i--) {
        const item = manyEntity.items[i];
        if (item.fk === true) {
          console.log(`🗑️ Force removing FK: ${item.name} from ${manyEntity.key} (aggressive cleanup)`);
          manyEntity.items.splice(i, 1);
          return;
        }
      }
    }
  }

  /**
   * Remove N:N relationship by cleaning up intermediary entities
   * @param relationship - N:N relationship to be removed
   */
  private removeManyToManyRelationship(relationship: any): void {
    console.log(`🔗 Removing N:N relationship between ${relationship.from} and ${relationship.to}`);

    // For N:N relationships, we need to check if either entity is an intermediary
    // and clean up appropriately
    const fromEntity = this.findEntityByKey(relationship.from);
    const toEntity = this.findEntityByKey(relationship.to);

    if (fromEntity && this.isIntermediaryEntity(fromEntity)) {
      console.log(`📊 ${relationship.from} is an intermediary entity - marking for cleanup`);
    }

    if (toEntity && this.isIntermediaryEntity(toEntity)) {
      console.log(`📊 ${relationship.to} is an intermediary entity - marking for cleanup`);
    }

    // The cleanup will happen in cleanupOrphanedIntermediaryEntities()
    console.log(`🔗 N:N relationship marked for cleanup - intermediary entities will be removed automatically`);
  }

  /**
   * Remove foreign key from entity that references another entity
   * @param entity - Entity to remove FK from
   * @param referencedEntityKey - Key of the referenced entity
   * @returns true if FK was found and removed, false otherwise
   */
  private removeForeignKeyFromEntity(entity: EntityModel, referencedEntityKey: string): boolean {
    console.log(`🔍 Searching for FK in ${entity.key} that references ${referencedEntityKey}`);

    // Find all foreign keys in the entity (items with fk: true)
    const foreignKeys = entity.items.filter(item => item.fk === true);
    console.log(`📋 Found ${foreignKeys.length} foreign keys in ${entity.key}:`, foreignKeys.map(fk => fk.name));

    if (foreignKeys.length === 0) {
      console.log(`⚠️ No foreign keys found in ${entity.key}`);
      return false;
    }

    // Look for FK that likely references the target entity by name pattern
    // Handle both singular and plural forms
    const entitySingular = this.getSingularForm(referencedEntityKey);
    console.log(`🔤 Entity forms: "${referencedEntityKey}" → singular: "${entitySingular}"`);

    const possibleFKNames = [
      `${referencedEntityKey}_id`,
      `${referencedEntityKey}Id`,
      `${referencedEntityKey.toLowerCase()}_id`,
      `${entitySingular}_id`,
      `${entitySingular}Id`,
      `${entitySingular.toLowerCase()}_id`,
      `id_${referencedEntityKey}`,
      `fk_${referencedEntityKey}`,
      `${referencedEntityKey.toUpperCase()}_ID`,
      `${entitySingular.toUpperCase()}_ID`
    ];

    // First, try exact matches with common naming patterns
    for (const fkName of possibleFKNames) {
      console.log(`🔍 Checking pattern: "${fkName}"`);
      const fkIndex = entity.items.findIndex(item =>
        item.fk === true && item.name.toLowerCase() === fkName.toLowerCase()
      );

      if (fkIndex !== -1) {
        const removedFK = entity.items.splice(fkIndex, 1)[0];
        console.log(`🗑️ FK removed by exact match: ${removedFK.name} from entity ${entity.key}`);
        return true;
      } else {
        // Debug: show what we're comparing
        const matchingNames = foreignKeys.filter(fk => fk.name.toLowerCase() === fkName.toLowerCase());
        /* istanbul ignore next -- unreachable: `foreignKeys` only contains items
           with fk === true, so a non-empty `matchingNames` would also have
           satisfied the identical findIndex predicate above and taken the `if`
           branch. This debug arm contradicts its own guard. Left in place
           because behaviour is deliberately not being changed. */
        if (matchingNames.length > 0) {
          console.log(`🔍 Found name match but not FK: ${matchingNames[0].name} (fk: ${matchingNames[0].fk})`);
        }
      }
    }

    // If exact match not found, search for any FK that contains the referenced entity name
    const relatedFKs = foreignKeys.filter(item => {
      const itemName = item.name.toLowerCase();
      const entityName = referencedEntityKey.toLowerCase();
      const singularName = entitySingular.toLowerCase();

      return itemName.includes(entityName) || itemName.includes(singularName);
    });

    if (relatedFKs.length > 0) {
      console.log(`🤔 Found ${relatedFKs.length} possible related FKs by name pattern:`, relatedFKs.map(fk => fk.name));
      // Remove the most likely match (shortest name that contains the reference)
      const fkToRemove = relatedFKs.sort((a, b) => a.name.length - b.name.length)[0];
      const fkIndex = entity.items.findIndex(item => item === fkToRemove);
      if (fkIndex !== -1) {
        entity.items.splice(fkIndex, 1);
        console.log(`🗑️ FK removed by name pattern: ${fkToRemove.name} from entity ${entity.key}`);
        return true;
      }
    }

    console.log(`⚠️ No FK found in ${entity.key} that references ${referencedEntityKey}`);
    return false;
  }

  /**
   * Search and remove related FK when the default search fails (deprecated - kept for compatibility)
   * @param entity - Entity to search for
   * @param referencedEntityKey - Key of the referenced entity
   */
  private findAndRemoveRelatedForeignKey(entity: EntityModel, referencedEntityKey: string): void {
    this.removeForeignKeyFromEntity(entity, referencedEntityKey);
  }

  /**
   * Remove orphaned intermediary entities (N:N relationships)
   */
  private cleanupOrphanedIntermediaryEntities(): void {
    console.log(`🧹 Cleaning up orphaned intermediary entities...`);

    const intermediaryEntities = this.entities.filter(entity =>
      this.isIntermediaryEntity(entity)
    );

    console.log(`📊 Found ${intermediaryEntities.length} intermediary entities for verification`);

    let removedCount = 0;
    const entitiesToRemove: string[] = [];

    for (const intermediaryEntity of intermediaryEntities) {
      const relatedRelationships = this.relationships.filter(rel =>
        rel.from === intermediaryEntity.key || rel.to === intermediaryEntity.key
      );

      console.log(`🔗 Intermediary entity ${intermediaryEntity.key} has ${relatedRelationships.length} relationships`);

      // If an intermediary entity has less than 2 relationships, it is orphaned
      if (relatedRelationships.length < 2) {
        console.log(`🗑️ Marking orphaned intermediary entity for removal: ${intermediaryEntity.key}`);
        entitiesToRemove.push(intermediaryEntity.key);
      }
    }

    // Remove marked entities and their relationships
    for (const entityKey of entitiesToRemove) {
      // Remove all relationships from this entity
      this.relationships = this.relationships.filter(rel =>
        rel.from !== entityKey && rel.to !== entityKey
      );

      // Remove the intermediary entity
      const entityIndex = this.entities.findIndex(e => e.key === entityKey);
      if (entityIndex !== -1) {
        this.entities.splice(entityIndex, 1);
        removedCount++;
        console.log(`✅ Intermediary entity ${entityKey} removed`);
      }
    }

    if (removedCount > 0) {
      console.log(`🧹 Cleanup completed: ${removedCount} orphaned intermediary entities removed`);
    } else {
      console.log(`✅ No orphaned intermediary entities found`);
    }
  }

  /**
   * Check if an entity is an intermediary entity (N:N)
   * @param entity - Entity to be checked
   * @returns true if it is an intermediary entity
   */
  private isIntermediaryEntity(entity: EntityModel): boolean {
    // Check if it is an IntermediaryEntityModel
    const intermediaryEntity = entity as IntermediaryEntityModel;
    if (intermediaryEntity.firstEntityId && intermediaryEntity.secondEntityId) {
      return true;
    }

    // Check if it follows the naming pattern of intermediary entities
    const hasUnderscore = entity.key.includes('_');
    if (!hasUnderscore) {
      return false;
    }

    // Check if all attributes are FKs (characteristic of intermediary entity)
    const allAttributesAreFKs = entity.items.length > 0 &&
      entity.items.every(item => item.fk === true);

    // Check if it has exactly 2 FKs (common pattern for N:N)
    const hasTwoFKs = entity.items.filter(item => item.fk === true).length === 2;

    return allAttributesAreFKs && hasTwoFKs;
  }

  /**
   * Verify that relationship removal was successful
   * @param relationship - The relationship that was removed
   */
  private verifyRelationshipRemoval(relationship: any): void {
    console.log(`🔍 Verifying removal of relationship between ${relationship.from} and ${relationship.to}`);

    const fromEntity = this.findEntityByKey(relationship.from);
    const toEntity = this.findEntityByKey(relationship.to);

    // Check for orphaned FKs that might reference the relationship
    if (fromEntity) {
      const remainingFKs = fromEntity.items.filter(item => item.fk === true);
      const orphanedFKs = remainingFKs.filter(item =>
        item.name.toLowerCase().includes(relationship.to.toLowerCase()) ||
        item.name.toLowerCase().includes(`${relationship.to.toLowerCase()}_id`)
      );

      if (orphanedFKs.length > 0) {
        console.warn(`⚠️ Found ${orphanedFKs.length} potentially orphaned FKs in ${fromEntity.key}:`,
          orphanedFKs.map(fk => fk.name));
      } else if (remainingFKs.length > 0) {
        console.log(`✅ ${fromEntity.key} has ${remainingFKs.length} remaining FKs (not related to removed relationship):`,
          remainingFKs.map(fk => fk.name));
      } else {
        console.log(`✅ ${fromEntity.key} has no remaining FKs`);
      }
    }

    if (toEntity) {
      const remainingFKs = toEntity.items.filter(item => item.fk === true);
      const orphanedFKs = remainingFKs.filter(item =>
        item.name.toLowerCase().includes(relationship.from.toLowerCase()) ||
        item.name.toLowerCase().includes(`${relationship.from.toLowerCase()}_id`)
      );

      if (orphanedFKs.length > 0) {
        console.warn(`⚠️ Found ${orphanedFKs.length} potentially orphaned FKs in ${toEntity.key}:`,
          orphanedFKs.map(fk => fk.name));
      } else if (remainingFKs.length > 0) {
        console.log(`✅ ${toEntity.key} has ${remainingFKs.length} remaining FKs (not related to removed relationship):`,
          remainingFKs.map(fk => fk.name));
      } else {
        console.log(`✅ ${toEntity.key} has no remaining FKs`);
      }
    }

    console.log(`✅ Relationship removal verification completed`);
  }

  /**
   * Get singular form of a word (simple implementation)
   * @param word - The word to convert to singular
   * @returns Singular form of the word
   */
  private getSingularForm(word: string): string {
    const lowerWord = word.toLowerCase();

    // Handle common plural patterns
    if (lowerWord.endsWith('ies')) {
      return word.slice(0, -3) + 'y';
    } else if (lowerWord.endsWith('es')) {
      return word.slice(0, -2);
    } else if (lowerWord.endsWith('s') && !lowerWord.endsWith('ss')) {
      return word.slice(0, -1);
    }

    // If no plural pattern found, return as-is
    return word;
  }

  /**
   * Find an entity by its key
   * @param key - Key of the entity
   * @returns Found entity or undefined
   */
  private findEntityByKey(key: string): EntityModel | undefined {
    return this.entities.find(entity => entity.key === key);
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
    this.isUpdatingFromServer = true;
    const data = JSON.parse(message.body);
    this.locations = data.nodeDataArray.map((entity: EntityModel) => {
      return new go.Point(Number(entity.location.x), Number(entity.location.y));
    });
    this.entities = data.nodeDataArray;
    this.relationships = data.linkDataArray;
    this.remakeDiagram();
    this.isUpdatingFromServer = false;
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

    this.diagramRenderer.refreshBindings(this.diagram);
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

}

