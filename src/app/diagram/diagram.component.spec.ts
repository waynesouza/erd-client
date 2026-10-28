import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import * as go from 'gojs';
import { of, throwError } from 'rxjs';
import { DiagramComponent } from './diagram.component';
import { DiagramRendererService } from './diagram-renderer.service';
import { StompClientFactory } from './stomp-client.factory';
import { DdlService } from '../service/ddl.service';
import { DiagramService } from '../service/diagram.service';
import { ProjectService } from '../service/project.service';
import { StorageService } from '../service/storage.service';
import { DataType } from '../model/enum/datatype.enum';
import { DiagramModel } from '../model/diagram.model';
import { EntityModel } from '../model/entity.model';
import {
  CollaborationServiceStub,
  createDdlServiceSpy,
  createDiagramServiceSpy,
  createProjectServiceSpy,
  createStorageSpy,
  provideCollaborationStub,
  provideSharedStub,
  SharedServiceStub
} from '../../testing/service-doubles';
import {
  FakeDiagram,
  asDiagram,
  createRendererSpy,
  createThrowingDiagram
} from '../../testing/gojs-doubles';
import { FakeStompClient, createStompFactorySpy } from '../../testing/stomp-doubles';
import { DialogSpies, installDialogSpies } from '../../testing/dialogs';
import { makeAttribute, makeEntity, makeEntityLock, makeProject, makeUser } from '../../testing/fixtures';
import { EntityEditFormStubComponent } from '../../testing/stubs/entity-edit-form.stub.component';

/**
 * The GoJS canvas and the SockJS transport are the only parts not exercised
 * here: both live behind DiagramRendererService / StompClientFactory, which
 * are excluded from coverage and stubbed below. Everything the component
 * itself decides - including every value the GoJS templates bind to - is
 * covered as plain functions.
 */
describe('DiagramComponent', () => {
  let fixture: ComponentFixture<DiagramComponent>;
  let component: DiagramComponent;
  let diagramSpy: jasmine.SpyObj<DiagramService>;
  let ddlSpy: jasmine.SpyObj<DdlService>;
  let projectSpy: jasmine.SpyObj<ProjectService>;
  let storageSpy: jasmine.SpyObj<StorageService>;
  let collaboration: CollaborationServiceStub;
  let shared: SharedServiceStub;
  let renderer: jasmine.SpyObj<DiagramRendererService>;
  let stompFactory: jasmine.SpyObj<StompClientFactory>;
  let stompClient: FakeStompClient;
  let fakeDiagram: FakeDiagram;
  let dialogs: DialogSpies;

  beforeEach(async () => {
    diagramSpy = createDiagramServiceSpy();
    ddlSpy = createDdlServiceSpy();
    projectSpy = createProjectServiceSpy();
    storageSpy = createStorageSpy();
    collaboration = new CollaborationServiceStub();
    shared = new SharedServiceStub();
    fakeDiagram = new FakeDiagram();
    renderer = createRendererSpy(asDiagram(fakeDiagram));
    stompClient = new FakeStompClient();
    stompFactory = createStompFactorySpy(stompClient);

    storageSpy.getUser.and.returnValue(makeUser());
    diagramSpy.getDiagram.and.returnValue(of({ nodeDataArray: [], linkDataArray: [] }));
    projectSpy.getProjectById.and.returnValue(of(makeProject()));

    await TestBed.configureTestingModule({
      declarations: [DiagramComponent, EntityEditFormStubComponent],
      providers: [
        { provide: DiagramService, useValue: diagramSpy },
        { provide: DdlService, useValue: ddlSpy },
        { provide: ProjectService, useValue: projectSpy },
        { provide: StorageService, useValue: storageSpy },
        { provide: DiagramRendererService, useValue: renderer },
        { provide: StompClientFactory, useValue: stompFactory },
        provideCollaborationStub(collaboration),
        provideSharedStub(shared)
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DiagramComponent);
    component = fixture.componentInstance;
    dialogs = installDialogSpies();
    spyOn(console, 'log');
    spyOn(console, 'warn');
    spyOn(console, 'error');
  });

  /** Gives the component a diagram without going through the real renderer. */
  function withDiagram(): void {
    component.diagram = asDiagram(fakeDiagram);
  }

  const relationship = (overrides: Record<string, unknown> = {}) => ({
    id: 'rel-1', from: 'Customer', to: 'Invoice', text: '1:N', toText: 1, ...overrides
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should adopt the stored user', () => {
    expect(component.currentUser).toEqual(makeUser());
  });

  // ============================================================ pure host API

  describe('getDataTypeColor', () => {
    it('should colour each known data type', () => {
      expect(component.getDataTypeColor('INTEGER')).toBe('#3b82f6');
      expect(component.getDataTypeColor('VARCHAR')).toBe('#10b981');
      expect(component.getDataTypeColor('BOOLEAN')).toBe('#8b5cf6');
      expect(component.getDataTypeColor('TIMESTAMP')).toBe('#f59e0b');
      expect(component.getDataTypeColor('UUID')).toBe('#6b7280');
    });

    it('should fall back to grey for an unknown type', () => {
      expect(component.getDataTypeColor('MONEY')).toBe('#9ca3af');
    });
  });

  describe('buildAttributeTooltip', () => {
    it('should list every constraint', () => {
      const tooltip = component.buildAttributeTooltip({
        name: 'customer_id', type: 'INTEGER',
        pk: true, fk: true, unique: true, autoIncrement: true, nullable: false
      });

      // `unique` is suppressed while `pk` is set.
      expect(tooltip).toBe(
        'customer_id\nType: INTEGER\nConstraints: Primary Key, Foreign Key, Auto Increment, Not Null'
      );
    });

    it('should report a unique non-key attribute', () => {
      const tooltip = component.buildAttributeTooltip({
        name: 'email', type: 'VARCHAR',
        pk: false, fk: false, unique: true, autoIncrement: false, nullable: true
      });

      expect(tooltip).toBe('email\nType: VARCHAR\nConstraints: Unique');
    });

    it('should say so when there are no constraints', () => {
      const tooltip = component.buildAttributeTooltip({
        name: 'note', type: 'TEXT',
        pk: false, fk: false, unique: false, autoIncrement: false, nullable: true
      });

      expect(tooltip).toBe('note\nType: TEXT\nConstraints: No constraints');
    });
  });

  describe('presentation helpers', () => {
    it('should bold a primary-key attribute', () => {
      expect(component.getAttributeFont(true)).toBe('bold 14px Inter, system-ui, sans-serif');
      expect(component.getAttributeFont(false)).toBe('14px Inter, system-ui, sans-serif');
    });

    it('should label a primary key', () => {
      expect(component.getPkLabel(true)).toBe('PK');
      expect(component.getPkLabel(false)).toBe('');
    });

    it('should use light colours in light mode', () => {
      component.darkMode = false;

      expect(component.getPrimaryTextStroke()).toBe('#1f2937');
      expect(component.getSecondaryTextStroke()).toBe('#6b7280');
      expect(component.getNodeFill()).toBe('white');
      expect(component.getNodeStroke()).toBe('#e5e7eb');
      expect(component.getHeaderBackground()).toBe('#f3f4f6');
      expect(component.getLinkStroke()).toBe('#6b7280');
    });

    it('should use dark colours in dark mode', () => {
      component.darkMode = true;

      expect(component.getPrimaryTextStroke()).toBe('#f3f4f6');
      expect(component.getSecondaryTextStroke()).toBe('#9ca3af');
      expect(component.getNodeFill()).toBe('#374151');
      expect(component.getNodeStroke()).toBe('#4b5563');
      expect(component.getHeaderBackground()).toBe('#1f2937');
      expect(component.getLinkStroke()).toBe('#4b5563');
    });

    it('should toggle dark mode', () => {
      component.toggleDarkMode();
      expect(component.darkMode).toBeTrue();

      component.toggleDarkMode();
      expect(component.darkMode).toBeFalse();
    });
  });

  describe('lock indicators', () => {
    it('should know whether an entity is locked at all', () => {
      component.lockedEntities = [makeEntityLock({ entityId: 'entity-1' })];

      expect(component.isEntityLocked('entity-1')).toBeTrue();
      expect(component.isEntityLocked('entity-9')).toBeFalse();
    });

    it('should show an open padlock for the current user', () => {
      collaboration.isEntityLockedByCurrentUser.and.returnValue(true);

      expect(component.getLockIcon('entity-1')).toBe('🔓');
      expect(component.getLockStrokeColor('entity-1')).toBe('#10b981');
    });

    it('should show a closed padlock for another user', () => {
      collaboration.isEntityLockedByCurrentUser.and.returnValue(false);

      expect(component.getLockIcon('entity-1')).toBe('🔒');
      expect(component.getLockStrokeColor('entity-1')).toBe('#dc2626');
    });

    it('should label an unlocked entity with nothing', () => {
      component.lockedEntities = [];

      expect(component.getLockUserLabel('entity-1')).toBe('');
    });

    it('should label the current user as You', () => {
      component.lockedEntities = [makeEntityLock({ entityId: 'entity-1' })];
      collaboration.isEntityLockedByCurrentUser.and.returnValue(true);

      expect(component.getLockUserLabel('entity-1')).toBe('You');
    });

    it('should label another user by first name', () => {
      component.lockedEntities = [
        makeEntityLock({ entityId: 'entity-1', userName: 'Grace Hopper' })
      ];
      collaboration.isEntityLockedByCurrentUser.and.returnValue(false);

      expect(component.getLockUserLabel('entity-1')).toBe('Grace');
    });
  });

  describe('resolveLockVisual', () => {
    it('should mark an entity locked by someone else as unavailable', () => {
      const lock = makeEntityLock({ entityId: 'entity-1', userName: 'Grace Hopper' });
      component.lockedEntities = [lock];
      collaboration.isEntityLockedByOtherUser.and.returnValue(true);

      const visual = component.resolveLockVisual('entity-1');

      expect(visual.opacity).toBe(0.7);
      expect(visual.stroke).toBe('#dc2626');
      expect(visual.strokeWidth).toBe(3);
      expect(visual.dash).toEqual([8, 4]);
      expect(visual.cursor).toBe('not-allowed');
      expect(visual.isOwnLock).toBeFalse();
      expect(visual.tooltipText).toContain('Being edited by: Grace Hopper');
    });

    it('should mark an entity the current user holds as editable', () => {
      component.lockedEntities = [makeEntityLock({ entityId: 'entity-1' })];
      collaboration.isEntityLockedByOtherUser.and.returnValue(false);
      collaboration.isEntityLockedByCurrentUser.and.returnValue(true);

      const visual = component.resolveLockVisual('entity-1');

      expect(visual.opacity).toBe(1.0);
      expect(visual.stroke).toBe('#10b981');
      expect(visual.strokeWidth).toBe(3);
      expect(visual.dash).toBeNull();
      expect(visual.cursor).toBe('pointer');
      expect(visual.isOwnLock).toBeTrue();
      expect(visual.tooltipText).toContain('You are editing this entity');
    });

    it('should leave a free entity in its default look', () => {
      component.lockedEntities = [];

      const visual = component.resolveLockVisual('entity-1');

      expect(visual.opacity).toBe(1.0);
      expect(visual.stroke).toBe('#e5e7eb');
      expect(visual.strokeWidth).toBe(1);
      expect(visual.tooltipText).toBeNull();
    });

    it('should use the dark default stroke for a free entity in dark mode', () => {
      component.darkMode = true;
      component.lockedEntities = [];

      expect(component.resolveLockVisual('entity-1').stroke).toBe('#4b5563');
    });

    it('should fall through to the default when a lock is claimed but missing', () => {
      // isEntityLockedByOtherUser says yes but lockedEntities has no record.
      collaboration.isEntityLockedByOtherUser.and.returnValue(true);
      component.lockedEntities = [];

      expect(component.resolveLockVisual('entity-1').stroke).toBe('#e5e7eb');
    });

    it('should fall through when the current user claims a lock with no record', () => {
      collaboration.isEntityLockedByCurrentUser.and.returnValue(true);
      component.lockedEntities = [];

      expect(component.resolveLockVisual('entity-1').strokeWidth).toBe(1);
    });
  });

  describe('buildLockTooltipText', () => {
    it('should address the current user directly', () => {
      const text = component.buildLockTooltipText(makeEntityLock(), true);

      expect(text).toContain('🔓 You are editing this entity');
      expect(text).toContain('Locked at:');
    });

    it('should name the holder otherwise', () => {
      const text = component.buildLockTooltipText(makeEntityLock({ userName: 'Grace' }), false);

      expect(text).toContain('🔒 Being edited by: Grace');
    });
  });

  describe('onDiagramModified', () => {
    it('should queue a save and clear the dirty flag', () => {
      withDiagram();
      component.projectId = 'project-1';
      fakeDiagram.isModified = true;
      const queued = jasmine.createSpy('queued');
      (component as unknown as { changeSubject: { subscribe(f: () => void): void } })
        .changeSubject.subscribe(queued);

      component.onDiagramModified();

      expect(queued).toHaveBeenCalled();
      expect(fakeDiagram.isModified).toBeFalse();
    });

    it('should ignore changes while applying a server update', () => {
      withDiagram();
      component.projectId = 'project-1';
      (component as unknown as { isUpdatingFromServer: boolean }).isUpdatingFromServer = true;
      const queued = jasmine.createSpy('queued');
      (component as unknown as { changeSubject: { subscribe(f: () => void): void } })
        .changeSubject.subscribe(queued);

      component.onDiagramModified();

      expect(queued).not.toHaveBeenCalled();
    });

    it('should ignore changes when no project is open', () => {
      withDiagram();
      component.projectId = '';
      const queued = jasmine.createSpy('queued');
      (component as unknown as { changeSubject: { subscribe(f: () => void): void } })
        .changeSubject.subscribe(queued);

      component.onDiagramModified();

      expect(queued).not.toHaveBeenCalled();
    });
  });

  describe('role helpers', () => {
    it('should map each role to an icon', () => {
      const icons: Record<string, string> = {
        OWNER: 'bi-crown', EDITOR: 'bi-pencil', VIEWER: 'bi-eye', NONE: 'bi-person'
      };
      Object.entries(icons).forEach(([role, icon]) => {
        component.userRole = role;
        expect(component.getRoleIcon()).withContext(role).toBe(icon);
      });
    });

    it('should map each role to a label', () => {
      const labels: Record<string, string> = {
        OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer', NONE: 'No Access'
      };
      Object.entries(labels).forEach(([role, label]) => {
        component.userRole = role;
        expect(component.getUserRoleDisplay()).withContext(role).toBe(label);
      });
    });
  });

  describe('getFirstName', () => {
    it('should take the first word', () => {
      expect(component.getFirstName('Grace Hopper')).toBe('Grace');
    });

    it('should fall back for an empty name', () => {
      expect(component.getFirstName('')).toBe('User');
    });

    it('should fall back when the name is only a space', () => {
      // The only way to reach the right operand of `parts[0] || 'User'`.
      expect(component.getFirstName(' ')).toBe('User');
    });
  });

  describe('getEntityName', () => {
    it('should resolve a known entity', () => {
      component.entities = [makeEntity({ id: 'entity-1', key: 'Customer' })];

      expect(component.getEntityName('entity-1')).toBe('Customer');
    });

    it('should report an unknown entity', () => {
      component.entities = [];

      expect(component.getEntityName('entity-9')).toBe('Unknown Entity');
    });

    it('should report an entity with a blank name', () => {
      component.entities = [makeEntity({ id: 'entity-1', key: '' })];

      expect(component.getEntityName('entity-1')).toBe('Unknown Entity');
    });
  });

  // ============================================================ relationships

  describe('getSingularForm', () => {
    const singular = (word: string) =>
      (component as unknown as { getSingularForm(w: string): string }).getSingularForm(word);

    it('should convert an -ies plural', () => {
      expect(singular('Categories')).toBe('Categor' + 'y');
    });

    it('should convert an -es plural', () => {
      expect(singular('Boxes')).toBe('Box');
    });

    it('should convert a simple -s plural', () => {
      expect(singular('Customers')).toBe('Customer');
    });

    it('should leave an -ss word alone', () => {
      expect(singular('Address')).toBe('Address');
    });

    it('should leave a singular word alone', () => {
      expect(singular('Customer')).toBe('Customer');
    });
  });

  describe('findEntityByKey', () => {
    const find = (key: string) =>
      (component as unknown as { findEntityByKey(k: string): EntityModel | undefined })
        .findEntityByKey(key);

    it('should find a known entity', () => {
      const entity = makeEntity({ key: 'Customer' });
      component.entities = [entity];

      expect(find('Customer')).toBe(entity);
    });

    it('should return undefined for an unknown key', () => {
      component.entities = [];

      expect(find('Customer')).toBeUndefined();
    });
  });

  describe('isIntermediaryEntity', () => {
    const isIntermediary = (entity: EntityModel) =>
      (component as unknown as { isIntermediaryEntity(e: EntityModel): boolean })
        .isIntermediaryEntity(entity);

    it('should recognise an explicit intermediary model', () => {
      const entity = {
        ...makeEntity({ key: 'CustomerInvoice' }),
        firstEntityId: 'Customer',
        secondEntityId: 'Invoice'
      } as EntityModel;

      expect(isIntermediary(entity)).toBeTrue();
    });

    it('should reject an entity whose name has no underscore', () => {
      expect(isIntermediary(makeEntity({ key: 'Customer' }))).toBeFalse();
    });

    it('should recognise the two-foreign-key naming pattern', () => {
      const entity = makeEntity({
        key: 'Customer_Invoice',
        items: [
          makeAttribute({ name: 'customer_id', fk: true, pk: false }),
          makeAttribute({ name: 'invoice_id', fk: true, pk: false })
        ]
      });

      expect(isIntermediary(entity)).toBeTrue();
    });

    it('should reject an underscored entity that also has non-key columns', () => {
      const entity = makeEntity({
        key: 'Customer_Invoice',
        items: [
          makeAttribute({ name: 'customer_id', fk: true, pk: false }),
          makeAttribute({ name: 'invoice_id', fk: true, pk: false }),
          makeAttribute({ name: 'quantity', fk: false, pk: false })
        ]
      });

      expect(isIntermediary(entity)).toBeFalse();
    });

    it('should reject an underscored entity with a single foreign key', () => {
      const entity = makeEntity({
        key: 'Customer_Invoice',
        items: [makeAttribute({ name: 'customer_id', fk: true, pk: false })]
      });

      expect(isIntermediary(entity)).toBeFalse();
    });

    it('should reject an underscored entity with no columns', () => {
      expect(isIntermediary(makeEntity({ key: 'Customer_Invoice', items: [] }))).toBeFalse();
    });
  });

  describe('removeForeignKeyFromEntity', () => {
    const removeFk = (entity: EntityModel, referenced: string) =>
      (component as unknown as {
        removeForeignKeyFromEntity(e: EntityModel, r: string): boolean
      }).removeForeignKeyFromEntity(entity, referenced);

    it('should report failure when the entity has no foreign keys', () => {
      const entity = makeEntity({ items: [makeAttribute({ name: 'id', pk: true })] });

      expect(removeFk(entity, 'Invoice')).toBeFalse();
      expect(entity.items.length).toBe(1);
    });

    it('should remove a snake_case foreign key', () => {
      const entity = makeEntity({
        items: [
          makeAttribute({ name: 'id', pk: true }),
          makeAttribute({ name: 'Invoice_id', fk: true, pk: false })
        ]
      });

      expect(removeFk(entity, 'Invoice')).toBeTrue();
      expect(entity.items.map(i => i.name)).toEqual(['id']);
    });

    it('should remove a camelCase foreign key', () => {
      const entity = makeEntity({
        items: [makeAttribute({ name: 'InvoiceId', fk: true, pk: false })]
      });

      expect(removeFk(entity, 'Invoice')).toBeTrue();
      expect(entity.items).toEqual([]);
    });

    it('should remove an id-prefixed foreign key', () => {
      const entity = makeEntity({
        items: [makeAttribute({ name: 'id_Invoice', fk: true, pk: false })]
      });

      expect(removeFk(entity, 'Invoice')).toBeTrue();
    });

    it('should remove an fk-prefixed foreign key', () => {
      const entity = makeEntity({
        items: [makeAttribute({ name: 'fk_Invoice', fk: true, pk: false })]
      });

      expect(removeFk(entity, 'Invoice')).toBeTrue();
    });

    it('should match the singular form of a plural entity name', () => {
      const entity = makeEntity({
        items: [makeAttribute({ name: 'invoice_id', fk: true, pk: false })]
      });

      expect(removeFk(entity, 'Invoices')).toBeTrue();
    });

    it('should ignore a matching name that is not marked as a foreign key', () => {
      // Drives the debug arm that reports a name match without the fk flag.
      const entity = makeEntity({
        items: [
          makeAttribute({ name: 'Invoice_id', fk: false, pk: false }),
          makeAttribute({ name: 'other_ref', fk: true, pk: false })
        ]
      });

      expect(removeFk(entity, 'Invoice')).toBeFalse();
      expect(entity.items.length).toBe(2);
    });

    it('should fall back to a fuzzy name match', () => {
      const entity = makeEntity({
        items: [makeAttribute({ name: 'billing_invoice_reference', fk: true, pk: false })]
      });

      expect(removeFk(entity, 'Invoice')).toBeTrue();
      expect(entity.items).toEqual([]);
    });

    it('should prefer the shortest fuzzy match', () => {
      const entity = makeEntity({
        items: [
          makeAttribute({ name: 'a_very_long_invoice_column', fk: true, pk: false }),
          makeAttribute({ name: 'short_invoice', fk: true, pk: false })
        ]
      });

      expect(removeFk(entity, 'Invoice')).toBeTrue();
      expect(entity.items.map(i => i.name)).toEqual(['a_very_long_invoice_column']);
    });

    it('should report failure when no foreign key relates to the entity', () => {
      const entity = makeEntity({
        items: [makeAttribute({ name: 'customer_id', fk: true, pk: false })]
      });

      expect(removeFk(entity, 'Invoice')).toBeFalse();
      expect(entity.items.length).toBe(1);
    });
  });

  describe('processRelationshipRemoval', () => {
    const process = (rel: unknown) =>
      (component as unknown as { processRelationshipRemoval(r: unknown): void })
        .processRelationshipRemoval(rel);

    beforeEach(() => {
      component.entities = [
        makeEntity({
          id: 'e1', key: 'Customer',
          items: [
            makeAttribute({ name: 'id', pk: true }),
            makeAttribute({ name: 'Invoice_id', fk: true, pk: false })
          ]
        }),
        makeEntity({
          id: 'e2', key: 'Invoice',
          items: [makeAttribute({ name: 'id', pk: true })]
        })
      ];
    });

    it('should drop the foreign key of a 1:1 relationship', () => {
      process(relationship({ text: '1:1' }));

      expect(component.entities[0].items.map(i => i.name)).toEqual(['id']);
    });

    it('should try the reverse direction for a 1:1 relationship', () => {
      component.entities[0].items = [makeAttribute({ name: 'id', pk: true })];
      component.entities[1].items = [
        makeAttribute({ name: 'id', pk: true }),
        makeAttribute({ name: 'Customer_id', fk: true, pk: false })
      ];

      process(relationship({ text: '1:1' }));

      expect(component.entities[1].items.map(i => i.name)).toEqual(['id']);
    });

    it('should warn when a 1:1 relationship has no foreign key', () => {
      component.entities[0].items = [makeAttribute({ name: 'id', pk: true })];

      process(relationship({ text: '1:1' }));

      expect(console.warn).toHaveBeenCalled();
    });

    it('should give up on a 1:1 relationship with an unknown source', () => {
      process(relationship({ text: '1:1', from: 'Ghost' }));

      expect(component.entities[0].items.length).toBe(2);
    });

    it('should give up on a 1:1 relationship with an unknown target', () => {
      process(relationship({ text: '1:1', to: 'Ghost' }));

      expect(component.entities[0].items.length).toBe(2);
    });

    it('should drop the foreign key of a 1:N relationship', () => {
      process(relationship({ text: '1:N' }));

      expect(component.entities[0].items.map(i => i.name)).toEqual(['id']);
    });

    it('should try the reverse direction for a 1:N relationship', () => {
      component.entities[0].items = [makeAttribute({ name: 'id', pk: true })];
      component.entities[1].items = [
        makeAttribute({ name: 'id', pk: true }),
        makeAttribute({ name: 'Customer_id', fk: true, pk: false })
      ];

      process(relationship({ text: '1:N' }));

      expect(component.entities[1].items.map(i => i.name)).toEqual(['id']);
    });

    it('should warn when a 1:N relationship has no foreign key', () => {
      component.entities[0].items = [makeAttribute({ name: 'id', pk: true })];

      process(relationship({ text: '1:N' }));

      expect(console.warn).toHaveBeenCalled();
    });

    it('should give up on a 1:N relationship with an unknown source', () => {
      process(relationship({ text: '1:N', from: 'Ghost' }));

      expect(component.entities[0].items.length).toBe(2);
    });

    it('should give up on a 1:N relationship with an unknown target', () => {
      process(relationship({ text: '1:N', to: 'Ghost' }));

      expect(component.entities[0].items.length).toBe(2);
    });

    it('should drop the foreign key of an N:1 relationship', () => {
      process(relationship({ text: 'N:1' }));

      expect(component.entities[0].items.map(i => i.name)).toEqual(['id']);
    });

    it('should aggressively drop any foreign key when the N:1 match fails', () => {
      component.entities[0].items = [
        makeAttribute({ name: 'id', pk: true }),
        makeAttribute({ name: 'unrelated_ref', fk: true, pk: false })
      ];

      process(relationship({ text: 'N:1' }));

      expect(component.entities[0].items.map(i => i.name)).toEqual(['id']);
    });

    it('should leave an N:1 entity with no foreign keys untouched', () => {
      component.entities[0].items = [makeAttribute({ name: 'id', pk: true })];

      process(relationship({ text: 'N:1' }));

      expect(component.entities[0].items.map(i => i.name)).toEqual(['id']);
    });

    it('should give up on an N:1 relationship with an unknown many side', () => {
      process(relationship({ text: 'N:1', from: 'Ghost' }));

      expect(component.entities[0].items.length).toBe(2);
    });

    it('should give up on an N:1 relationship with an unknown one side', () => {
      process(relationship({ text: 'N:1', to: 'Ghost' }));

      expect(component.entities[0].items.length).toBe(2);
    });

    it('should defer N:N cleanup to the orphan sweep', () => {
      process(relationship({ text: 'N:N' }));

      expect(component.entities.length).toBe(2);
    });

    it('should note an intermediary source in an N:N relationship', () => {
      component.entities[0] = makeEntity({
        id: 'e1', key: 'Customer_Invoice',
        items: [
          makeAttribute({ name: 'customer_id', fk: true, pk: false }),
          makeAttribute({ name: 'invoice_id', fk: true, pk: false })
        ]
      });

      process(relationship({ text: 'N:N', from: 'Customer_Invoice' }));

      expect(component.entities.length).toBe(2);
    });

    it('should note an intermediary target in an N:N relationship', () => {
      component.entities[1] = makeEntity({
        id: 'e2', key: 'Customer_Invoice',
        items: [
          makeAttribute({ name: 'customer_id', fk: true, pk: false }),
          makeAttribute({ name: 'invoice_id', fk: true, pk: false })
        ]
      });

      process(relationship({ text: 'N:N', to: 'Customer_Invoice' }));

      expect(component.entities.length).toBe(2);
    });

    it('should warn about an unknown relationship type', () => {
      process(relationship({ text: 'M:M' }));

      expect(console.warn).toHaveBeenCalledWith('⚠️ Unknown relationship type: M:M');
    });
  });

  describe('cleanupOrphanedIntermediaryEntities', () => {
    const cleanup = () =>
      (component as unknown as { cleanupOrphanedIntermediaryEntities(): void })
        .cleanupOrphanedIntermediaryEntities();

    const intermediary = (key: string) => makeEntity({
      id: key, key,
      items: [
        makeAttribute({ name: 'customer_id', fk: true, pk: false }),
        makeAttribute({ name: 'invoice_id', fk: true, pk: false })
      ]
    });

    it('should remove an intermediary entity with too few relationships', () => {
      component.entities = [intermediary('Customer_Invoice')];
      component.relationships = [relationship({ from: 'Customer', to: 'Customer_Invoice' })];

      cleanup();

      expect(component.entities).toEqual([]);
      expect(component.relationships).toEqual([]);
    });

    it('should keep an intermediary entity that still joins two others', () => {
      component.entities = [intermediary('Customer_Invoice')];
      component.relationships = [
        relationship({ id: 'r1', from: 'Customer', to: 'Customer_Invoice' }),
        relationship({ id: 'r2', from: 'Customer_Invoice', to: 'Invoice' })
      ];

      cleanup();

      expect(component.entities.length).toBe(1);
      expect(component.relationships.length).toBe(2);
    });

    it('should do nothing when there are no intermediary entities', () => {
      component.entities = [makeEntity({ key: 'Customer' })];
      component.relationships = [];

      cleanup();

      expect(component.entities.length).toBe(1);
    });
  });

  describe('verifyRelationshipRemoval', () => {
    const verify = (rel: unknown) =>
      (component as unknown as { verifyRelationshipRemoval(r: unknown): void })
        .verifyRelationshipRemoval(rel);

    it('should warn about a foreign key still referencing the removed target', () => {
      component.entities = [
        makeEntity({ key: 'Customer', items: [makeAttribute({ name: 'invoice_id', fk: true, pk: false })] }),
        makeEntity({ key: 'Invoice', items: [makeAttribute({ name: 'id', pk: true })] })
      ];

      verify(relationship());

      expect(console.warn).toHaveBeenCalled();
    });

    it('should report unrelated foreign keys that survive', () => {
      component.entities = [
        makeEntity({ key: 'Customer', items: [makeAttribute({ name: 'region_id', fk: true, pk: false })] }),
        makeEntity({ key: 'Invoice', items: [makeAttribute({ name: 'region_id', fk: true, pk: false })] })
      ];

      verify(relationship());

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should report entities left with no foreign keys', () => {
      component.entities = [
        makeEntity({ key: 'Customer', items: [makeAttribute({ name: 'id', pk: true })] }),
        makeEntity({ key: 'Invoice', items: [makeAttribute({ name: 'id', pk: true })] })
      ];

      verify(relationship());

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should warn about a foreign key in the target referencing the source', () => {
      component.entities = [
        makeEntity({ key: 'Customer', items: [makeAttribute({ name: 'id', pk: true })] }),
        makeEntity({ key: 'Invoice', items: [makeAttribute({ name: 'customer_id', fk: true, pk: false })] })
      ];

      verify(relationship());

      expect(console.warn).toHaveBeenCalled();
    });

    it('should tolerate both endpoints being unknown', () => {
      component.entities = [];

      expect(() => verify(relationship())).not.toThrow();
    });
  });

  // ============================================================ orchestration

  describe('ngOnInit', () => {
    it('should build and activate a STOMP client for the configured endpoint', fakeAsync(() => {
      component.ngOnInit();
      tick(100);

      expect(stompFactory.create).toHaveBeenCalledOnceWith('http://localhost:8080/ws');
      expect(stompClient.activated).toBeTrue();
    }));

    it('should subscribe to the project topics once connected', fakeAsync(() => {
      component.ngOnInit();
      tick(100);
      component.projectId = 'project-1';

      stompClient.onConnect({ command: 'CONNECTED' });

      expect(stompClient.handlers.has('/topic/diagram/project-1')).toBeTrue();
      expect(stompClient.handlers.has('/topic/collaboration/project-1')).toBeTrue();
    }));

    it('should not subscribe on connect when no project is open', fakeAsync(() => {
      component.ngOnInit();
      tick(100);
      component.projectId = '';

      stompClient.onConnect({ command: 'CONNECTED' });

      expect(stompClient.handlers.size).toBe(0);
    }));

    it('should report a broker error', fakeAsync(() => {
      component.ngOnInit();
      tick(100);

      stompClient.onStompError({ headers: { message: 'bad frame' }, body: 'details' });

      expect(console.error).toHaveBeenCalledWith('Broker reported error: bad frame');
      expect(console.error).toHaveBeenCalledWith('Additional details: details');
    }));

    it('should clear the project data when no project is selected', fakeAsync(() => {
      component.ngOnInit();
      tick(100);

      // The shared service starts on null, which emits synchronously.
      expect(collaboration.clearProjectLocks).toHaveBeenCalled();
      expect(component.userRole).toBe('NONE');
      expect(component.canEdit).toBeFalse();
      expect(component.currentProject).toBeNull();
    }));

    it('should load a project when one is selected', fakeAsync(() => {
      component.ngOnInit();
      tick(100);

      shared.projectIdSubject.next('project-1');
      tick(100);

      expect(component.projectId).toBe('project-1');
      expect(projectSpy.getProjectById).toHaveBeenCalledWith('project-1');
      expect(diagramSpy.getDiagram).toHaveBeenCalledWith('project-1');
    }));

    it('should resubscribe to the topics when the project changes while connected', fakeAsync(() => {
      component.ngOnInit();
      tick(100);
      stompClient.connected = true;

      shared.projectIdSubject.next('project-1');
      tick(100);

      expect(stompClient.handlers.has('/topic/diagram/project-1')).toBeTrue();
    }));

    it('should refresh the diagram shortly after the locks change', fakeAsync(() => {
      component.ngOnInit();
      tick(100);
      withDiagram();
      renderer.applyLockStyling.calls.reset();
      const locks = [makeEntityLock()];

      collaboration.lockedEntitiesSubject.next(locks);
      expect(component.lockedEntities).toBe(locks);
      expect(renderer.applyLockStyling).not.toHaveBeenCalled();

      tick(100);

      expect(renderer.applyLockStyling).toHaveBeenCalled();
      expect(renderer.refreshBindings).toHaveBeenCalled();
    }));

    it('should skip the lock refresh when there is no diagram', fakeAsync(() => {
      component.ngOnInit();
      component.diagram = null as unknown as go.Diagram;

      collaboration.lockedEntitiesSubject.next([makeEntityLock()]);
      tick(100);

      expect(renderer.applyLockStyling).not.toHaveBeenCalled();
      expect(renderer.refreshBindings).not.toHaveBeenCalled();
    }));

    it('should debounce the autosave by 1.5 seconds', fakeAsync(() => {
      component.ngOnInit();
      tick(100);
      component.projectId = 'project-1';
      stompClient.connected = true;
      withDiagram();

      component.onDiagramModified();
      component.onDiagramModified();
      expect(stompClient.published.length).toBe(0);

      tick(1500);

      expect(stompClient.published.length).toBe(1);
    }));
  });

  describe('subscribeToProjectTopics', () => {
    beforeEach(fakeAsync(() => {
      component.ngOnInit();
      tick(100);
      stompClient.connected = true;
    }));

    it('should apply an incoming diagram update', fakeAsync(() => {
      shared.projectIdSubject.next('project-1');
      tick(100);
      withDiagram();

      stompClient.deliver('/topic/diagram/project-1', JSON.stringify({
        nodeDataArray: [{ id: 'e1', key: 'Customer', items: [], location: { x: 5, y: 6 } }],
        linkDataArray: []
      }));

      expect(component.entities.length).toBe(1);
      expect(component.locations[0].x).toBe(5);
    }));

    it('should hand a collaboration message to the service', fakeAsync(() => {
      shared.projectIdSubject.next('project-1');
      tick(100);
      const message = { type: 'ENTITY_LOCKED', payload: {}, projectId: 'project-1', userId: 'u', userEmail: 'e' };

      stompClient.deliver('/topic/collaboration/project-1', JSON.stringify(message));

      expect(collaboration.processCollaborationMessage).toHaveBeenCalledOnceWith(message as never);
    }));

    it('should drop the previous subscriptions when the project changes', fakeAsync(() => {
      shared.projectIdSubject.next('project-1');
      tick(100);

      shared.projectIdSubject.next('project-2');
      tick(100);

      expect(stompClient.unsubscribed).toEqual([
        '/topic/diagram/project-1', '/topic/collaboration/project-1'
      ]);
    }));
  });

  describe('loadProjectData', () => {
    const load = (id = 'project-1') =>
      (component as unknown as { loadProjectData(i: string): void }).loadProjectData(id);

    it('should record the role and load the locks', () => {
      const project = makeProject();
      projectSpy.getProjectById.and.returnValue(of(project));
      collaboration.getCurrentUserRole.and.returnValue('EDITOR');
      collaboration.canEditDiagram.and.returnValue(true);
      collaboration.getProjectLocks.and.returnValue(of([makeEntityLock()]));

      load();

      expect(component.currentProject).toBe(project);
      expect(component.userRole).toBe('EDITOR');
      expect(component.canEdit).toBeTrue();
      expect(collaboration.clearUserLocks).toHaveBeenCalled();
      expect(collaboration.getProjectLocks).toHaveBeenCalledWith('project-1');
      expect(component.lockedEntities.length).toBe(1);
    });

    it('should still load the locks when clearing the stale ones fails', () => {
      collaboration.clearUserLocks.and.returnValue(throwError(() => new Error('boom')));
      collaboration.getProjectLocks.and.returnValue(of([]));

      load();

      expect(console.warn).toHaveBeenCalled();
      expect(collaboration.getProjectLocks).toHaveBeenCalled();
    });

    it('should reset the permissions when the project cannot be loaded', () => {
      component.currentProject = makeProject();
      component.canEdit = true;
      projectSpy.getProjectById.and.returnValue(throwError(() => new Error('boom')));

      load();

      expect(component.currentProject).toBeNull();
      expect(component.userRole).toBe('NONE');
      expect(component.canEdit).toBeFalse();
    });

    it('should report a failure to load the locks', () => {
      collaboration.getProjectLocks.and.returnValue(throwError(() => new Error('boom')));

      load();

      expect(console.error).toHaveBeenCalledWith('Error loading project locks:', jasmine.any(Error));
    });
  });

  describe('loadDiagramData', () => {
    const load = (id = 'project-1') =>
      (component as unknown as { loadDiagramData(i: string): void }).loadDiagramData(id);

    it('should adopt the entities, links and locations', () => {
      diagramSpy.getDiagram.and.returnValue(of({
        nodeDataArray: [
          { id: 'e1', key: 'Customer', items: [], location: { x: 10, y: 20 } } as unknown as EntityModel
        ],
        linkDataArray: [{ from: 'Customer', to: 'Invoice', text: '1:N', toText: '1' }]
      }));

      load();

      expect(component.entities.length).toBe(1);
      expect(component.relationships.length).toBe(1);
      expect(component.locations[0].x).toBe(10);
      expect(component.locations[0].y).toBe(20);
      expect(renderer.create).toHaveBeenCalled();
    });

    it('should default a missing location to the origin', () => {
      diagramSpy.getDiagram.and.returnValue(of({
        nodeDataArray: [{ id: 'e1', key: 'Customer', items: [] } as unknown as EntityModel],
        linkDataArray: []
      }));

      load();

      expect(component.locations[0].x).toBe(0);
      expect(component.locations[0].y).toBe(0);
    });

    it('should default missing links to an empty list', () => {
      diagramSpy.getDiagram.and.returnValue(of({
        nodeDataArray: [], linkDataArray: null as unknown as []
      }));

      load();

      expect(component.relationships).toEqual([]);
    });

    it('should fall back to an empty diagram for an invalid payload', () => {
      component.entities = [makeEntity()];
      diagramSpy.getDiagram.and.returnValue(
        of({ nodeDataArray: null } as unknown as DiagramModel)
      );

      load();

      expect(component.entities).toEqual([]);
      expect(component.relationships).toEqual([]);
      expect(renderer.create).toHaveBeenCalled();
    });

    it('should fall back to an empty diagram when the request fails', () => {
      component.entities = [makeEntity()];
      diagramSpy.getDiagram.and.returnValue(throwError(() => new Error('boom')));

      load();

      expect(component.entities).toEqual([]);
      expect(renderer.create).toHaveBeenCalled();
    });
  });

  describe('ngOnDestroy', () => {
    it('should tear down the diagram, the timers and the transport', fakeAsync(() => {
      component.ngOnInit();
      tick(100);
      stompClient.connected = true;   // otherwise no topics are ever subscribed
      shared.projectIdSubject.next('project-1');
      tick(100);
      withDiagram();

      component.ngOnDestroy();

      expect(component.diagram).toBeNull();
      expect(fakeDiagram.div).toBeNull();
      expect(stompClient.unsubscribed.length).toBe(2);
      expect(stompClient.deactivated).toBeTrue();
    }));

    it('should tolerate being destroyed before anything was created', () => {
      expect(() => component.ngOnDestroy()).not.toThrow();
    });
  });

  // ============================================================ editing

  describe('addEntity', () => {
    beforeEach(() => {
      spyOn(crypto, 'randomUUID').and.returnValue('11111111-1111-4111-8111-111111111111');
      spyOn(Math, 'random').and.returnValue(0.5);
    });

    it('should refuse a user without edit rights', () => {
      component.canEdit = false;
      component.userRole = 'VIEWER';

      component.addEntity();

      expect(component.entities.length).toBe(0);
      expect(dialogs.alert).toHaveBeenCalledOnceWith(
        'You have view-only access to this diagram. Contact the project owner for edit permissions.'
      );
    });

    it('should report a generic denial for a user with no role', () => {
      component.canEdit = false;
      component.userRole = 'NONE';

      component.addEntity();

      expect(dialogs.alert)
        .toHaveBeenCalledOnceWith('You do not have permission to edit this diagram.');
    });

    it('should append a numbered entity at a random position', () => {
      component.canEdit = true;
      withDiagram();

      component.addEntity();

      expect(component.entities.length).toBe(1);
      expect(component.entities[0].key).toBe('table1');
      expect(component.entities[0].id).toBe('11111111-1111-4111-8111-111111111111');
      expect(component.entities[0].location.x).toBe(200);
    });

    it('should create the diagram first when there is none', () => {
      component.canEdit = true;
      component.diagram = null as unknown as go.Diagram;

      component.addEntity();

      expect(renderer.create).toHaveBeenCalled();
      expect(component.entities.length).toBe(1);
    });
  });

  describe('showTableEditorModal', () => {
    const entity = { id: 'entity-1', key: 'Customer' };

    it('should refuse a user without edit rights', () => {
      component.canEdit = false;

      component.showTableEditorModal(entity);

      expect(collaboration.lockEntity).not.toHaveBeenCalled();
      expect(dialogs.alert).toHaveBeenCalled();
    });

    it('should report a conflict with the lock details', () => {
      component.canEdit = true;
      component.lockedEntities = [
        makeEntityLock({ entityId: 'entity-1', userName: 'Grace Hopper' })
      ];
      collaboration.checkEditConflict.and.returnValue({
        canEdit: false, message: 'Entity is being edited by Grace Hopper'
      });

      component.showTableEditorModal(entity);

      const message = dialogs.alert.calls.mostRecent().args[0] as string;
      expect(message).toContain('Entity is being edited by Grace Hopper');
      expect(message).toContain('📊 Entity: Customer');
      expect(message).toContain('👤 Being edited by: Grace Hopper');
      expect(collaboration.lockEntity).not.toHaveBeenCalled();
    });

    it('should report a conflict without details when no lock record exists', () => {
      component.canEdit = true;
      component.lockedEntities = [];
      collaboration.checkEditConflict.and.returnValue({ canEdit: false, message: 'Locked' });

      component.showTableEditorModal(entity);

      expect(dialogs.alert).toHaveBeenCalledOnceWith('Locked');
    });

    it('should lock the entity and open the editor', () => {
      component.canEdit = true;
      component.projectId = 'project-1';
      collaboration.lockEntity.and.returnValue(of(makeEntityLock()));

      component.showTableEditorModal(entity);

      expect(collaboration.lockEntity).toHaveBeenCalledOnceWith('entity-1', 'project-1');
      expect(component.selectedEntity).toBe(entity);
      expect(component.isEntityEditorModalOpen).toBeTrue();
    });

    it('should offer a recovery path when the lock fails', fakeAsync(() => {
      // fakeAsync so the 500ms retry timer is drained inside this spec rather
      // than firing during whichever spec happens to run next.
      component.canEdit = true;
      collaboration.lockEntity.and.returnValue(throwError(() => new Error('locked')));
      collaboration.forceCleanupStaleLocks.and.returnValue(of(undefined));
      collaboration.getProjectLocks.and.returnValue(of([]));

      component.showTableEditorModal(entity);
      tick(500);

      expect(dialogs.confirm).toHaveBeenCalled();
      expect(collaboration.forceCleanupStaleLocks).toHaveBeenCalled();
    }));
  });

  describe('handleLockFailure', () => {
    const entity = { id: 'entity-1', key: 'Customer' };
    const fail = () =>
      (component as unknown as { handleLockFailure(e: unknown): void }).handleLockFailure(entity);

    it('should do nothing when the user declines', () => {
      dialogs.confirm.and.returnValue(false);

      fail();

      expect(collaboration.forceCleanupStaleLocks).not.toHaveBeenCalled();
    });

    it('should retry the lock after cleaning up', fakeAsync(() => {
      collaboration.forceCleanupStaleLocks.and.returnValue(of(undefined));
      collaboration.getProjectLocks.and.returnValue(of([]));
      collaboration.lockEntity.and.returnValue(of(makeEntityLock()));

      fail();
      tick(500);

      expect(component.selectedEntity).toBe(entity);
      expect(component.isEntityEditorModalOpen).toBeTrue();
    }));

    it('should report a retry that also fails', fakeAsync(() => {
      collaboration.forceCleanupStaleLocks.and.returnValue(of(undefined));
      collaboration.getProjectLocks.and.returnValue(of([]));
      collaboration.lockEntity.and.returnValue(throwError(() => new Error('still locked')));

      fail();
      tick(500);

      expect(dialogs.alert).toHaveBeenCalledWith(
        '❌ Still unable to lock entity for editing. Please try again later.'
      );
      expect(component.isEntityEditorModalOpen).toBeFalse();
    }));

    it('should report a failed cleanup', () => {
      collaboration.forceCleanupStaleLocks.and.returnValue(throwError(() => new Error('boom')));

      fail();

      expect(dialogs.alert).toHaveBeenCalledWith(
        '❌ Failed to clean up stale locks. Please try again later or contact support.'
      );
    });
  });

  describe('handleSave', () => {
    it('should replace the entity and rename it across the relationships', () => {
      withDiagram();
      component.entities = [makeEntity({ id: 'e1', key: 'Customer' })];
      component.relationships = [
        relationship({ from: 'Customer', to: 'Invoice' }),
        relationship({ id: 'rel-2', from: 'Invoice', to: 'Customer' })
      ];
      const updated = makeEntity({ id: 'e1', key: 'Client' });

      component.handleSave(updated);

      expect(component.entities[0]).toBe(updated);
      expect(component.relationships[0].from).toBe('Client');
      expect(component.relationships[1].to).toBe('Client');
      expect(component.showTableEditor).toBeFalse();
    });

    it('should leave unrelated relationships alone', () => {
      withDiagram();
      component.entities = [makeEntity({ id: 'e1', key: 'Customer' })];
      component.relationships = [relationship({ from: 'Order', to: 'Invoice' })];

      component.handleSave(makeEntity({ id: 'e1', key: 'Client' }));

      expect(component.relationships[0].from).toBe('Order');
      expect(component.relationships[0].to).toBe('Invoice');
    });
  });

  describe('handleRemove', () => {
    it('should drop the entity, its links and the foreign keys pointing at it', () => {
      withDiagram();
      component.entities = [
        makeEntity({ id: 'e1', key: 'Invoice', items: [makeAttribute({ name: 'id', pk: true })] }),
        makeEntity({
          id: 'e2', key: 'Customer',
          items: [makeAttribute({ name: 'id', pk: true }), makeAttribute({ name: 'Invoice_id', fk: true, pk: false })]
        })
      ];
      component.relationships = [relationship({ from: 'e1', to: 'e2' })];

      component.handleRemove('e1');

      expect(component.entities.map(e => e.id)).toEqual(['e2']);
      expect(component.entities[0].items.map(i => i.name)).toEqual(['id']);
      expect(component.relationships).toEqual([]);
    });

    it('should tolerate removing an unknown entity', () => {
      withDiagram();
      component.entities = [makeEntity({ id: 'e1' })];

      component.handleRemove('ghost');

      expect(component.entities.length).toBe(1);
    });

    it('should drop a relationship that only points AT the removed entity', () => {
      // Drives the right operand of `r.from !== id && r.to !== id`, which the
      // source-side case short-circuits past.
      withDiagram();
      component.entities = [makeEntity({ id: 'e1', key: 'Invoice' })];
      component.relationships = [
        relationship({ from: 'other', to: 'e1' }),
        relationship({ id: 'rel-2', from: 'other', to: 'kept' })
      ];

      component.handleRemove('e1');

      expect(component.relationships.map(r => r.id)).toEqual(['rel-2']);
    });
  });

  describe('findAndRemoveRelatedForeignKey', () => {
    it('should delegate to the foreign-key removal', () => {
      // Deprecated and called from nowhere in the app, but still shipped code.
      const entity = makeEntity({
        items: [makeAttribute({ name: 'Invoice_id', fk: true, pk: false })]
      });

      (component as unknown as {
        findAndRemoveRelatedForeignKey(e: EntityModel, k: string): void
      }).findAndRemoveRelatedForeignKey(entity, 'Invoice');

      expect(entity.items).toEqual([]);
    });
  });

  describe('handleClose', () => {
    it('should hide the table editor', () => {
      component.showTableEditor = true;

      component.handleClose();

      expect(component.showTableEditor).toBeFalse();
    });
  });

  // ============================================================ relationships

  describe('selectRelationshipType', () => {
    it('should refuse a user without edit rights', () => {
      component.canEdit = false;

      component.selectRelationshipType('1:N');

      expect(component.selectedRelationshipType).toBeNull();
      expect(dialogs.alert).toHaveBeenCalled();
    });

    it('should arm the given relationship type', () => {
      component.canEdit = true;

      component.selectRelationshipType('1:N');

      expect(component.selectedRelationshipType).toBe('1:N');
      expect(component.selectedEntities).toEqual([]);
    });

    it('should disarm when the same type is chosen again', () => {
      component.canEdit = true;
      component.selectRelationshipType('1:N');

      component.selectRelationshipType('1:N');

      expect(component.selectedRelationshipType).toBeNull();
    });

    it('should switch to a different type', () => {
      component.canEdit = true;
      component.selectRelationshipType('1:N');

      component.selectRelationshipType('N:N');

      expect(component.selectedRelationshipType).toBe('N:N');
    });
  });

  describe('entityClicked', () => {
    const customer = () => makeEntity({
      id: 'e1', key: 'Customer', items: [makeAttribute({ name: 'id', pk: true, type: DataType.INTEGER })]
    });
    const invoice = () => makeEntity({
      id: 'e2', key: 'Invoice', items: [makeAttribute({ name: 'id', pk: true, type: DataType.INTEGER })]
    });

    beforeEach(() => {
      spyOn(crypto, 'randomUUID').and.returnValues(
        'uuid-1' as `${string}-${string}-${string}-${string}-${string}`,
        'uuid-2' as `${string}-${string}-${string}-${string}-${string}`,
        'uuid-3' as `${string}-${string}-${string}-${string}-${string}`
      );
      spyOn(Math, 'random').and.returnValue(0.25);
      withDiagram();
      component.canEdit = true;
    });

    it('should ignore clicks when no relationship type is armed', () => {
      component.entityClicked(customer());

      expect(component.selectedEntities).toEqual([]);
    });

    it('should refuse an entity without a primary key', () => {
      component.selectRelationshipType('1:N');
      const keyless = makeEntity({ key: 'Draft', items: [makeAttribute({ pk: false })] });

      component.entityClicked(keyless);

      expect(component.selectedEntities).toEqual([]);
      expect(dialogs.alert).toHaveBeenCalledOnceWith(
        "Entity 'Draft': This table needs a primary key to create relationships."
      );
    });

    it('should ignore an entity that is already selected', () => {
      component.selectRelationshipType('1:N');
      const entity = customer();

      component.entityClicked(entity);
      component.entityClicked(entity);

      expect(component.selectedEntities.length).toBe(1);
    });

    it('should create a 1:N relationship once two entities are chosen', () => {
      const source = customer();
      const target = invoice();
      component.entities = [source, target];
      component.selectRelationshipType('1:N');

      component.entityClicked(source);
      component.entityClicked(target);

      expect(source.items.map(i => i.name)).toEqual(['id', 'Invoice_id']);
      expect(source.items[1].fk).toBeTrue();
      expect(source.items[1].unique).toBeFalse();
      expect(component.relationships.length).toBe(1);
      expect(component.relationships[0].text).toBe('1:N');
      expect(component.selectedRelationshipType).toBeNull();
    });

    it('should mark the foreign key unique for a 1:1 relationship', () => {
      const source = customer();
      const target = invoice();
      component.entities = [source, target];
      component.selectRelationshipType('1:1');

      component.entityClicked(source);
      component.entityClicked(target);

      expect(source.items[1].unique).toBeTrue();
      expect(component.relationships[0].text).toBe('1:1');
    });

    it('should build a join table for an N:N relationship', () => {
      const source = customer();
      const target = invoice();
      component.entities = [source, target];
      component.selectRelationshipType('N:N');

      component.entityClicked(source);
      component.entityClicked(target);

      expect(component.entities.length).toBe(3);
      const join = component.entities[2];
      expect(join.key).toBe('Customer_Invoice');
      expect(join.items.map(i => i.name)).toEqual(['Customer_id', 'Invoice_id']);
      expect(join.items.every(i => i.fk)).toBeTrue();
      expect(component.relationships.length).toBe(2);
    });

    it('should do nothing when the selection is incomplete', () => {
      (component as unknown as { createRelationshipFromSelection(): void })
        .createRelationshipFromSelection();

      expect(component.relationships).toEqual([]);
    });
  });

  describe('createRelationship', () => {
    it('should record the link and clear the selection', () => {
      withDiagram();
      component.selectedEntities = [makeEntity()];

      component.createRelationship(relationship());

      expect(component.relationships.length).toBe(1);
      expect(component.selectedEntities).toEqual([]);
    });
  });

  describe('removeRelationship', () => {
    it('should ignore an unknown relationship', () => {
      withDiagram();
      component.relationships = [relationship()];

      component.removeRelationship('ghost');

      expect(component.relationships.length).toBe(1);
      expect(console.warn).toHaveBeenCalledWith('Relationship with ID ghost not found');
    });

    it('should drop the relationship and its foreign key', () => {
      withDiagram();
      component.entities = [
        makeEntity({
          id: 'e1', key: 'Customer',
          items: [makeAttribute({ name: 'id', pk: true }), makeAttribute({ name: 'Invoice_id', fk: true, pk: false })]
        }),
        makeEntity({ id: 'e2', key: 'Invoice', items: [makeAttribute({ name: 'id', pk: true })] })
      ];
      component.relationships = [relationship({ text: '1:N' })];

      component.removeRelationship('rel-1');

      expect(component.relationships).toEqual([]);
      expect(component.entities[0].items.map(i => i.name)).toEqual(['id']);
    });
  });

  describe('remakeDiagram', () => {
    it('should create the diagram when there is none', () => {
      component.diagram = null as unknown as go.Diagram;

      component.remakeDiagram();

      expect(renderer.create).toHaveBeenCalled();
    });

    it('should reuse the stored locations', () => {
      withDiagram();
      component.entities = [makeEntity()];
      component.locations = [{ x: 11, y: 22 }];

      component.remakeDiagram();

      expect(component.entities[0].location.x).toBe(11);
      expect(component.entities[0].location.y).toBe(22);
    });

    it('should place an entity randomly when it has no stored location', () => {
      spyOn(Math, 'random').and.returnValue(0.5);
      withDiagram();
      component.entities = [makeEntity()];
      component.locations = [];

      component.remakeDiagram();

      expect(component.entities[0].location.x).toBe(200);
    });

    it('should report a failure to rebuild the model', () => {
      component.diagram = createThrowingDiagram();
      component.entities = [makeEntity()];

      component.remakeDiagram();

      expect(console.error).toHaveBeenCalledWith('Error remaking diagram:', jasmine.any(Error));
    });
  });

  describe('receiveMessageAndRemakeDiagram', () => {
    it('should replace the whole diagram from the message', () => {
      withDiagram();

      component.receiveMessageAndRemakeDiagram({
        body: JSON.stringify({
          nodeDataArray: [{ id: 'e1', key: 'Customer', items: [], location: { x: 3, y: 4 } }],
          linkDataArray: [relationship()]
        })
      });

      expect(component.entities.length).toBe(1);
      expect(component.relationships.length).toBe(1);
      expect(component.locations[0].x).toBe(3);
    });

    it('should throw on a node with no location', () => {
      // Recorded defect: unlike loadDiagramData, this path has no `?.` guard.
      withDiagram();

      expect(() => component.receiveMessageAndRemakeDiagram({
        body: JSON.stringify({ nodeDataArray: [{ id: 'e1', key: 'C', items: [] }], linkDataArray: [] })
      })).toThrowError(TypeError);
    });

    it('should throw on a malformed payload', () => {
      withDiagram();

      expect(() => component.receiveMessageAndRemakeDiagram({ body: 'not json' })).toThrow();
    });
  });

  // ============================================================ modal & sync

  describe('entity editor modal', () => {
    it('should open', () => {
      component.openEntityEditorModal();

      expect(component.isEntityEditorModalOpen).toBeTrue();
    });

    it('should unlock the entity on close', () => {
      component.projectId = 'project-1';
      component.selectedEntity = { id: 'entity-1' };
      component.isEntityEditorModalOpen = true;

      component.closeEntityEditorModal();

      expect(collaboration.unlockEntity).toHaveBeenCalledOnceWith('entity-1', 'project-1');
      expect(component.isEntityEditorModalOpen).toBeFalse();
      expect(component.selectedEntity).toEqual({});
    });

    it('should close without unlocking when nothing was selected', () => {
      component.selectedEntity = {};

      component.closeEntityEditorModal();

      expect(collaboration.unlockEntity).not.toHaveBeenCalled();
      expect(component.isEntityEditorModalOpen).toBeFalse();
    });

    it('should report a failed unlock but still close', () => {
      component.selectedEntity = { id: 'entity-1' };
      collaboration.unlockEntity.and.returnValue(throwError(() => new Error('boom')));

      component.closeEntityEditorModal();

      expect(console.error).toHaveBeenCalledWith('Error unlocking entity:', jasmine.any(Error));
      expect(component.isEntityEditorModalOpen).toBeFalse();
    });
  });

  describe('sendToServer', () => {
    beforeEach(fakeAsync(() => {
      component.ngOnInit();
      tick(100);
    }));

    it('should publish the diagram when connected', () => {
      stompClient.connected = true;
      component.projectId = 'project-1';
      component.entities = [makeEntity()];
      component.darkMode = true;

      component.sendToServer();

      expect(stompClient.published.length).toBe(1);
      expect(stompClient.published[0].destination).toBe('/app/send');
      const body = JSON.parse(stompClient.published[0].body);
      expect(body.projectId).toBe('project-1');
      expect(body.darkMode).toBeTrue();
      expect(body.nodeDataArray.length).toBe(1);
    });

    it('should skip publishing when disconnected', () => {
      stompClient.connected = false;

      component.sendToServer();

      expect(stompClient.published.length).toBe(0);
      expect(console.log)
        .toHaveBeenCalledWith('Cannot send message, stompClient is not connected');
    });
  });

  // ============================================================ DDL

  describe('exportDdl', () => {
    it('should do nothing without a project', () => {
      component.projectId = '';

      component.exportDdl();

      expect(ddlSpy.exportDdl).not.toHaveBeenCalled();
    });

    it('should download the generated file', () => {
      component.projectId = 'project-1';
      ddlSpy.exportDdl.and.returnValue(of({ ddlContent: 'CREATE TABLE t();', projectId: 'project-1' }));

      component.exportDdl();

      expect(ddlSpy.downloadSqlFile)
        .toHaveBeenCalledOnceWith('CREATE TABLE t();', 'project-1_diagram.sql');
    });

    it('should report a failed export', () => {
      component.projectId = 'project-1';
      ddlSpy.exportDdl.and.returnValue(throwError(() => new Error('boom')));

      component.exportDdl();

      expect(dialogs.alert).toHaveBeenCalledOnceWith('Error exporting DDL. Please try again.');
    });
  });

  describe('importDdl', () => {
    it('should do nothing without a project', () => {
      component.projectId = '';

      component.importDdl();

      expect(console.error).toHaveBeenCalledWith('No project selected for import');
    });

    it('should open the file picker', () => {
      component.projectId = 'project-1';
      const input = document.createElement('input');
      const click = spyOn(input, 'click');
      component.fileInput = { nativeElement: input };

      component.importDdl();

      expect(click).toHaveBeenCalled();
    });

    it('should tolerate the file input not being rendered', () => {
      component.projectId = 'project-1';
      component.fileInput = undefined as unknown as typeof component.fileInput;

      expect(() => component.importDdl()).not.toThrow();
    });
  });

  describe('onFileSelected', () => {
    let input: HTMLInputElement;

    function selectionEvent(fileName: string | null): Event {
      input = document.createElement('input');
      const files = fileName === null
        ? []
        : [new File(['CREATE TABLE t();'], fileName, { type: 'application/sql' })];
      Object.defineProperty(input, 'files', { value: files });
      return { target: input } as unknown as Event;
    }

    it('should do nothing when no file was chosen', () => {
      component.onFileSelected(selectionEvent(null));

      expect(ddlSpy.readSqlFile).not.toHaveBeenCalled();
    });

    it('should refuse a file that is not SQL', () => {
      component.onFileSelected(selectionEvent('notes.txt'));

      expect(dialogs.alert).toHaveBeenCalledOnceWith('Please select a valid SQL file.');
      expect(ddlSpy.readSqlFile).not.toHaveBeenCalled();
    });

    it('should import the file and reload the diagram', async () => {
      component.projectId = 'project-1';
      ddlSpy.readSqlFile.and.resolveTo('CREATE TABLE t();');
      ddlSpy.importDdl.and.returnValue(of(undefined));

      component.onFileSelected(selectionEvent('schema.sql'));
      await ddlSpy.readSqlFile.calls.mostRecent().returnValue;

      expect(ddlSpy.importDdl).toHaveBeenCalledOnceWith({
        projectId: 'project-1', ddlContent: 'CREATE TABLE t();'
      });
      expect(dialogs.alert).toHaveBeenCalledWith('DDL imported successfully! Reloading diagram...');
      expect(diagramSpy.getDiagram).toHaveBeenCalledWith('project-1');
    });

    it('should reset the input immediately', () => {
      ddlSpy.readSqlFile.and.resolveTo('CREATE TABLE t();');
      ddlSpy.importDdl.and.returnValue(of(undefined));

      component.onFileSelected(selectionEvent('schema.sql'));

      expect(input.value).toBe('');
    });

    it('should report a failed import', async () => {
      component.projectId = 'project-1';
      ddlSpy.readSqlFile.and.resolveTo('bad sql');
      ddlSpy.importDdl.and.returnValue(throwError(() => new Error('boom')));

      component.onFileSelected(selectionEvent('schema.sql'));
      await ddlSpy.readSqlFile.calls.mostRecent().returnValue;

      expect(dialogs.alert).toHaveBeenCalledWith(
        'Error importing DDL. Please check the file format and try again.'
      );
    });

    it('should report a file that cannot be read', async () => {
      ddlSpy.readSqlFile.and.rejectWith(new Error('unreadable'));

      component.onFileSelected(selectionEvent('schema.sql'));
      await ddlSpy.readSqlFile.calls.mostRecent().returnValue.catch(() => undefined);
      await Promise.resolve();

      expect(dialogs.alert).toHaveBeenCalledWith('Error reading file. Please try again.');
    });
  });
});
