import { AttributeModel } from '../app/model/attribute.model';
import { AuthResponseModel } from '../app/model/auth-response.model';
import { EntityModel } from '../app/model/entity.model';
import { DataType } from '../app/model/enum/datatype.enum';
import { Project, ProjectUser } from '../app/model/project.model';
import { TeamMember } from '../app/model/team-member.model';
import { EntityLock } from '../app/service/collaboration.service';

/** Builders returning valid objects by default; override only what a test cares about. */

export function makeAttribute(overrides: Partial<AttributeModel> = {}): AttributeModel {
  return {
    name: 'id',
    type: DataType.INTEGER,
    pk: true,
    fk: false,
    unique: false,
    defaultValue: '',
    nullable: false,
    autoIncrement: false,
    ...overrides
  };
}

export function makeEntity(overrides: Partial<EntityModel> = {}): EntityModel {
  return {
    id: 'entity-1',
    key: 'Customer',
    items: [makeAttribute()],
    location: { x: 0, y: 0 },
    ...overrides
  };
}

export function makeUser(overrides: Partial<AuthResponseModel> = {}): AuthResponseModel {
  return {
    token: 'token-abc',
    fullName: 'Ada Lovelace',
    email: 'ada@erd.com',
    ...overrides
  };
}

export function makeProjectUser(overrides: Partial<ProjectUser> = {}): ProjectUser {
  return {
    id: 'user-1',
    email: 'ada@erd.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'OWNER',
    ...overrides
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Sales ERD',
    description: 'Sales domain model',
    createdAt: '2026-01-01T00:00:00Z',
    usersDto: [makeProjectUser()],
    ...overrides
  };
}

export function makeTeamMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'user-1',
    email: 'ada@erd.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'OWNER',
    ...overrides
  };
}

export function makeEntityLock(overrides: Partial<EntityLock> = {}): EntityLock {
  return {
    entityId: 'entity-1',
    userId: 'user-2',
    userEmail: 'grace@erd.com',
    userName: 'Grace Hopper',
    lockedAt: new Date('2026-01-01T00:00:00Z'),
    projectId: 'project-1',
    ...overrides
  };
}
