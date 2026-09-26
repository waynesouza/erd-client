import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { DiagramComponent } from './diagram.component';
import { DiagramService } from '../service/diagram.service';
import { DdlService } from '../service/ddl.service';
import { ProjectService } from '../service/project.service';
import { StorageService } from '../service/storage.service';
import { StompClientFactory } from './stomp-client.factory';
import { EntityEditFormStubComponent } from '../../testing/stubs/entity-edit-form.stub.component';
import {
  CollaborationServiceStub, SharedServiceStub, createDdlServiceSpy, createDiagramServiceSpy,
  createProjectServiceSpy, createStorageSpy, provideCollaborationStub, provideSharedStub
} from '../../testing/service-doubles';
import { createStompFactorySpy, FakeStompClient } from '../../testing/stomp-doubles';
import { makeProject, makeUser } from '../../testing/fixtures';

/**
 * Exercises the real DiagramRendererService against a real <div>: the GoJS
 * attach/detach handshake is exactly what breaks when the user switches from
 * one project to another, and a stubbed renderer cannot see it.
 */
describe('DiagramComponent - switching between projects', () => {
  let fixture: ComponentFixture<DiagramComponent>;
  let component: DiagramComponent;
  let shared: SharedServiceStub;
  let diagramSpy: jasmine.SpyObj<DiagramService>;

  beforeEach(async () => {
    diagramSpy = createDiagramServiceSpy();
    const projectSpy = createProjectServiceSpy();
    const storageSpy = createStorageSpy();
    shared = new SharedServiceStub();

    storageSpy.getUser.and.returnValue(makeUser());
    diagramSpy.getDiagram.and.returnValue(of({ nodeDataArray: [], linkDataArray: [] }));
    projectSpy.getProjectById.and.returnValue(of(makeProject()));

    await TestBed.configureTestingModule({
      declarations: [DiagramComponent, EntityEditFormStubComponent],
      providers: [
        { provide: DiagramService, useValue: diagramSpy },
        { provide: DdlService, useValue: createDdlServiceSpy() },
        { provide: ProjectService, useValue: projectSpy },
        { provide: StorageService, useValue: storageSpy },
        { provide: StompClientFactory, useValue: createStompFactorySpy(new FakeStompClient()) },
        provideCollaborationStub(new CollaborationServiceStub()),
        provideSharedStub(shared)
        // DiagramRendererService is deliberately the real one.
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DiagramComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  function openProject(projectId: string): void {
    shared.projectIdSubject.next(projectId);
    fixture.detectChanges();
  }

  it('can add a table after opening a single project', () => {
    fixture.detectChanges();
    openProject('test-2');

    expect(() => component.addEntity()).not.toThrow();
    expect(component.entities.length).toBe(1);
  });

  /** Shaped like the backend's JSON: `location` is a plain object, not a go.Point. */
  function savedDiagram(tableName: string) {
    return {
      nodeDataArray: [
        { id: `${tableName}-1`, key: tableName, items: [{ name: 'id', type: 'INTEGER', pk: true }], location: { x: 120, y: 80 } }
      ],
      linkDataArray: []
    };
  }

  it('can add a table after switching between two projects that already have tables', () => {
    diagramSpy.getDiagram.and.callFake((id: string) => of(savedDiagram(id === 'test-1' ? 'Customer' : 'Invoice')) as any);

    fixture.detectChanges();
    openProject('test-1');
    openProject('test-2');

    expect(component.diagram).withContext('diagram after the switch').toBeTruthy();
    expect(() => component.addEntity()).not.toThrow();
  });

  it('can add a table after switching from one project to another', () => {
    fixture.detectChanges();
    openProject('test-1');
    openProject('test-2');

    expect(component.diagram).withContext('diagram after the switch').toBeTruthy();
    expect(() => component.addEntity()).not.toThrow();
    expect(component.entities.length).toBe(1);
  });
});

/**
 * Two DiagramComponent instances sharing the root-provided SharedService, which
 * is what the app ends up with whenever the route is re-entered: the outgoing
 * instance is destroyed but its subscription to `currentProjectId` is not.
 */
describe('DiagramComponent - a destroyed instance still listening', () => {
  let shared: SharedServiceStub;

  beforeEach(async () => {
    const diagramSpy = createDiagramServiceSpy();
    const projectSpy = createProjectServiceSpy();
    const storageSpy = createStorageSpy();
    shared = new SharedServiceStub();

    storageSpy.getUser.and.returnValue(makeUser());
    diagramSpy.getDiagram.and.returnValue(of({ nodeDataArray: [], linkDataArray: [] }));
    projectSpy.getProjectById.and.returnValue(of(makeProject()));

    await TestBed.configureTestingModule({
      declarations: [DiagramComponent, EntityEditFormStubComponent],
      providers: [
        { provide: DiagramService, useValue: diagramSpy },
        { provide: DdlService, useValue: createDdlServiceSpy() },
        { provide: ProjectService, useValue: projectSpy },
        { provide: StorageService, useValue: storageSpy },
        { provide: StompClientFactory, useValue: createStompFactorySpy(new FakeStompClient()) },
        provideCollaborationStub(new CollaborationServiceStub()),
        provideSharedStub(shared)
      ]
    }).compileComponents();
  });

  it('does not steal the div from the instance that is actually on screen', () => {
    const gone = TestBed.createComponent(DiagramComponent);
    gone.detectChanges();
    shared.projectIdSubject.next('test-1');
    gone.detectChanges();
    gone.destroy();

    const live = TestBed.createComponent(DiagramComponent);
    live.detectChanges();
    shared.projectIdSubject.next('test-2');
    live.detectChanges();

    expect(live.componentInstance.diagram).withContext('live instance diagram').toBeTruthy();
    expect(() => live.componentInstance.addEntity()).not.toThrow();
    live.destroy();
  });
});
