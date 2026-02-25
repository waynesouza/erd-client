import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { StorageService } from './storage.service';
import { AuthResponseModel } from '../model/auth-response.model';
import { environment } from '../../environments/environment';

const BASE_URL = `${environment.apiUrl}/collaboration`;
const httpOptions = { headers: new HttpHeaders({'Content-Type': 'application/json'}) };

export interface EntityLock {
  entityId: string;
  userId: string;
  userEmail: string;
  userName: string;
  lockedAt: Date;
  projectId: string;
}

export interface CollaborationMessage {
  type: 'ENTITY_LOCKED' | 'ENTITY_UNLOCKED' | 'USER_JOINED' | 'USER_LEFT' | 'ENTITY_UPDATED';
  payload: any;
  projectId: string;
  userId: string;
  userEmail: string;
}

@Injectable({
  providedIn: 'root'
})
export class CollaborationService {
  private lockedEntitiesSubject = new BehaviorSubject<EntityLock[]>([]);
  private activeUsersSubject = new BehaviorSubject<AuthResponseModel[]>([]);
  private currentUser: AuthResponseModel | null = null;

  public lockedEntities$ = this.lockedEntitiesSubject.asObservable();
  public activeUsers$ = this.activeUsersSubject.asObservable();

  constructor(
    private http: HttpClient,
    private storageService: StorageService
  ) {
    this.currentUser = this.storageService.getUser();
  }

  // Check if an entity is locked by another user
  isEntityLockedByOtherUser(entityId: string): boolean {
    const locks = this.lockedEntitiesSubject.value;
    const lock = locks.find((l: EntityLock) => l.entityId === entityId);
    return lock !== undefined && lock.userEmail !== this.currentUser?.email;
  }

  //Check if an entity is locked by the current user
  isEntityLockedByCurrentUser(entityId: string): boolean {
    const locks = this.lockedEntitiesSubject.value;
    const lock = locks.find((l: EntityLock) => l.entityId === entityId);
    return lock !== undefined && lock.userEmail === this.currentUser?.email;
  }

  // Get lock information for an entity
  getEntityLock(entityId: string): EntityLock | undefined {
    const locks = this.lockedEntitiesSubject.value;
    return locks.find((l: EntityLock) => l.entityId === entityId);
  }

  // Lock an entity for editing
  lockEntity(entityId: string, projectId: string): Observable<EntityLock> {
    const lockRequest = {
      entityId,
      projectId,
      userEmail: this.currentUser?.email,
      userName: this.currentUser?.fullName || this.currentUser?.email
    };

    return this.http.post<EntityLock>(`${BASE_URL}/lock-entity`, lockRequest, httpOptions);
  }

  // Unlock an entity
  unlockEntity(entityId: string, projectId: string): Observable<void> {
    const unlockRequest = {
      entityId,
      projectId,
      userEmail: this.currentUser?.email
    };

    return this.http.post<void>(`${BASE_URL}/unlock-entity`, unlockRequest, httpOptions);
  }

  // Get all locks of a project
  getProjectLocks(projectId: string): Observable<EntityLock[]> {
    return this.http.get<EntityLock[]>(`${BASE_URL}/project-locks/${projectId}`, httpOptions);
  }

  // Clear orphaned locks for the current user
  clearUserLocks(): Observable<void> {
    if (!this.currentUser?.email) {
      throw new Error('User not authenticated');
    }

    return this.http.delete<void>(`${BASE_URL}/user-locks/${encodeURIComponent(this.currentUser.email)}`, httpOptions);
  }

  // Force cleanup of orphaned locks (for emergency cases)
  forceCleanupStaleLocks(): Observable<void> {
    return this.http.post<void>(`${BASE_URL}/cleanup-stale-locks`, {}, httpOptions);
  }

  // Check if current user can edit (not VIEWER)
  canEditDiagram(projectUsers: any[]): boolean {
    if (!this.currentUser?.email) return false;

    const currentUserRole = projectUsers.find(user => user.email === this.currentUser?.email)?.role;
    return currentUserRole === 'OWNER' || currentUserRole === 'EDITOR';
  }

  // Get the current user's role in the project
  getCurrentUserRole(projectUsers: any[]): string {
    if (!this.currentUser?.email) return 'NONE';

    const user = projectUsers.find(user => user.email === this.currentUser?.email);
    return user?.role || 'NONE';
  }

  // Process collaboration messages received via WebSocket
  processCollaborationMessage(message: CollaborationMessage): void {
    const locks = this.lockedEntitiesSubject.value;

    console.log('Processing collaboration message:', message);

    switch (message.type) {
      case 'ENTITY_LOCKED':
        const newLock = message.payload as EntityLock;
        // Do not process if the user himself made the lock
        if (newLock.userEmail === this.currentUser?.email) {
          console.log('Ignoring own lock message');
          return;
        }

        const updatedLocks = [...locks.filter((l: EntityLock) => l.entityId !== newLock.entityId), newLock];
        this.lockedEntitiesSubject.next(updatedLocks);
        console.log('Entity locked by other user:', newLock);
        break;

      case 'ENTITY_UNLOCKED':
        const entityId = message.payload.entityId;
        const userEmail = message.payload.userEmail;

        // Do not process if the user himself performed the unlock
        if (userEmail === this.currentUser?.email) {
          console.log('Ignoring own unlock message');
          return;
        }

        const filteredLocks = locks.filter((l: EntityLock) => l.entityId !== entityId);
        this.lockedEntitiesSubject.next(filteredLocks);
        console.log('Entity unlocked by other user:', entityId);
        break;

      case 'USER_JOINED':
        // Update active users list
        console.log('User joined project:', message.payload);
        break;

      case 'USER_LEFT':
        // Remove user from active list and their locks
        const leftUserEmail = message.payload.userEmail;
        const locksWithoutUser = locks.filter((l: EntityLock) => l.userEmail !== leftUserEmail);
        this.lockedEntitiesSubject.next(locksWithoutUser);
        console.log('User left project, clearing their locks:', leftUserEmail);
        break;
    }
  }

  // Clear all locks when exiting the project
  clearProjectLocks(): void {
    this.lockedEntitiesSubject.next([]);
  }

  // Check for conflicts when trying to edit
  checkEditConflict(entityId: string): { canEdit: boolean; message?: string } {
    if (this.isEntityLockedByOtherUser(entityId)) {
      const lock = this.getEntityLock(entityId);
      return {
        canEdit: false,
        message: `Entity is being edited by ${lock?.userName || lock?.userEmail}`
      };
    }

    return { canEdit: true };
  }

}
