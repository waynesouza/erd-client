import { Component, EventEmitter, OnInit, Output, OnDestroy } from '@angular/core';
import { AuthService } from '../../service/auth.service';
import { Router } from '@angular/router';
import { ProjectService } from '../../service/project.service';
import { StorageService } from '../../service/storage.service';
import { SharedService } from '../../service/shared.service';
import { Subscription, Observable } from 'rxjs';
import { AuthResponseModel } from "../../model/auth-response.model";
import { Project } from "../../model/project.model";

interface UserResponse {
  name: string;
  email: string;
  avatar?: string;
}

@Component({
  selector: 'app-side-bar',
  templateUrl: './side-bar.component.html',
  styleUrls: ['./side-bar.component.scss']
})
export class SideBarComponent implements OnInit, OnDestroy {
  @Output() itemClicked: EventEmitter<string> = new EventEmitter<string>();
  @Output() sidebarCollapsed: EventEmitter<boolean> = new EventEmitter<boolean>();

  projects: Project[] = [];
  email: string = '';
  isModalOpen: boolean = false;
  hoveredProjectId: string | null = null;
  isEditMode: boolean = false;
  selectedProject: Project | null = null;
  isCollapsed: boolean = false;

  private subscription: Subscription = new Subscription();
  protected user: AuthResponseModel | null = null;
  userData$: Observable<UserResponse>;

  constructor(
    public authService: AuthService,
    public projectService: ProjectService,
    private storageService: StorageService,
    private router: Router,
    private sharedService: SharedService
  ) {
    this.user = this.storageService.getUser();
    this.userData$ = new Observable<UserResponse>();
  }

  ngOnInit(): void {
    this.buildProjectList();
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        console.log('Logout successful');
        this.sharedService.clearProjectId();
        void this.router.navigate(['/login']);
      },
      error: (error: any) => {
        console.error('Logout error:', error);
        // Even if server logout fails, clear local storage and redirect
        this.authService.setLoggedIn(false);
        this.sharedService.clearProjectId();
        void this.router.navigate(['/login']);
      }
    });
  }

  isLoginOrRegisterRoute(): boolean {
    const url: string = this.router.url;
    return url.includes('/login') || url.includes('/register');
  }

  buildProjectList(): void {
    if (!this.user?.email) return;

    console.log('Side-bar: Starting to get projects for user email:', this.user.email);

    // FIXME Fixed error messages
    this.subscription.add(
      this.projectService.getProjectsByUserEmail(this.user.email).subscribe({
        next: (response: Project[]) => {
          console.log('Side-bar: Projects response:', response);
          this.projects = response || [];
        },
        error: (error: any) => {
          console.error('Side-bar: Error getting projects:', error);
          console.error('Side-bar: Error status:', error.status);
          console.error('Side-bar: Error message:', error.message);
          this.projects = [];
        }
      })
    );
  }

  loadProject(projectId: string): void {
    this.sharedService.changeProjectId(projectId);
  }

  openCreateModal(): void {
    this.isEditMode = false;
    this.selectedProject = null;
    this.isModalOpen = true;
  }

  async openEditModal(project: Project, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    this.isEditMode = true;
    await this.getProjectDataById(project.id);
    this.isModalOpen = true;
  }

  closeModal(): void {
    this.isModalOpen = false;
    this.buildProjectList();
  }

  onProjectCreated(projectId: string): void {
    this.loadProject(projectId);
  }

  setHoveredProject(projectId: string | null): void {
    this.hoveredProjectId = projectId;
  }

  async getProjectDataById(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.subscription.add(
        this.projectService.getProjectById(id).subscribe({
          next: (response: Project) => {
            if (response) {
              this.selectedProject = response;
            }
            resolve();
          },
          error: (err) => {
            console.error('Erro ao buscar dados do projeto:', err);
            reject(err);
          }
        })
      );
    });
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  toggleSidebar(): void {
    this.isCollapsed = !this.isCollapsed;
    this.sidebarCollapsed.emit(this.isCollapsed);
  }

  handleUserResponse(response: UserResponse): void {
    // Handle user response
  }

  handleLogoutResponse(response: { success: boolean }): void {
    if (response.success) {
      void this.router.navigate(['/login']);
    }
  }

  isOwnerOfSelectedProject(): boolean {
    if (!this.selectedProject || !this.user) {
      return false;
    }
    return this.selectedProject?.usersDto.some(
      member => member.email === this.user?.email && member.role === 'OWNER'
    );
  }

  deleteSelectedProject(): void {
    if (!this.selectedProject) {
      return;
    }
    if (!this.isOwnerOfSelectedProject()) {
      alert('Only the project owner can delete this project.');
      return;
    }
    if (confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      this.projectService.deleteProject(this.selectedProject.id).subscribe({
        next: () => {
          this.selectedProject = null;
          this.buildProjectList();
        },
        error: (error: any) => {
          console.error('Error deleting project:', error);
          alert('Failed to delete project. Please try again.');
        }
      });
    }
  }

  isOwnerOfProject(project: Project): boolean {
    if (!project || !this.user) {
      return false;
    }
    console.log('Project:', project);
    return project.usersDto.some(
      member => member.email === this.user?.email && member.role === 'OWNER'
    );
  }

  deleteProject(project: Project, event: MouseEvent): void {
    event.stopPropagation();
    if (!this.isOwnerOfProject(project)) {
      alert('Only the project owner can delete this project.');
      return;
    }
    if (confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      this.projectService.deleteProject(project.id).subscribe({
        next: () => {
          if (this.selectedProject && this.selectedProject.id === project.id) {
            this.selectedProject = null;
          }
          this.buildProjectList();
        },
        error: (error: any) => {
          console.error('Error deleting project:', error);
          alert('Failed to delete project. Please try again.');
        }
      });
    }
  }

}
