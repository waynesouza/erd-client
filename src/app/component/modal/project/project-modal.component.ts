import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { StorageService } from '../../../service/storage.service';
import { ProjectService } from '../../../service/project.service';
import { DiagramService } from '../../../service/diagram.service';
import { Project, ProjectUser, CreateProjectDto, UpdateProjectDto } from '../../../model/project.model';

@Component({
  selector: 'app-project-modal',
  templateUrl: './project-modal.component.html',
  styleUrls: ['./project-modal.component.scss']
})
export class ProjectModalComponent implements OnInit {
  @Input() isEditMode: boolean = false;
  @Input() projectToEdit: Project | null = null;
  @Output() modalClosed = new EventEmitter<boolean>();
  @Output() projectCreated = new EventEmitter<string>();

  currentUser: ProjectUser | null = null;
  showAddMemberModal = false;
  newMemberEmail = '';
  newMemberRole: 'EDITOR' | 'VIEWER' = 'VIEWER';

  // Edit Member Modal properties
  showEditMemberModal = false;
  editMemberEmail = '';
  editMemberRole: 'OWNER' | 'EDITOR' | 'VIEWER' = 'VIEWER';
  memberBeingEdited: ProjectUser | null = null;

  newProject: CreateProjectDto = {
    name: '',
    description: '',
    userEmail: ''
  };

  editProject: UpdateProjectDto = {
    id: '',
    name: '',
    description: ''
  };

  constructor(
    private diagramService: DiagramService,
    private projectService: ProjectService,
    private storageService: StorageService
  ) {}

  ngOnInit(): void {
    const user = this.storageService.getUser();
    if (!user) {
      console.error('No user found in storage');
      this.closeModal();
      return;
    }
    this.currentUser = user;

    if (this.isEditMode && this.projectToEdit) {
      this.editProject = {
        id: this.projectToEdit.id,
        name: this.projectToEdit.name,
        description: this.projectToEdit.description
      };
    }
  }

  closeModal(): void {
    this.resetForm();
    this.modalClosed.emit(true);
  }

  submitForm(): void {
    if (!this.validateForm()) {
      return;
    }

    if (this.isEditMode) {
      this.updateProject();
    } else {
      this.createProject();
    }
  }

  get currentProject(): CreateProjectDto | UpdateProjectDto {
    return this.isEditMode ? this.editProject : this.newProject;
  }

  isOwner(): boolean {
    if (!this.currentUser || !this.projectToEdit) {
      return false;
    }

    const currentMember = this.projectToEdit.usersDto.find(
      member => member.email === this.currentUser?.email
    );

    return currentMember?.role === 'OWNER';
  }

  canManageMembers(): boolean {
    return this.isOwner();
  }

  canManageProject(): boolean {
    if (!this.currentUser || !this.projectToEdit) {
      return false;
    }

    const currentMember = this.projectToEdit.usersDto.find(
      member => member.email === this.currentUser?.email
    );

    // OWNER and EDITOR can manage project, VIEWER cannot
    return currentMember?.role === 'OWNER' || currentMember?.role === 'EDITOR';
  }

  canChangeRole(member: ProjectUser): boolean {
    // Only the OWNER can change roles
    if (!this.isOwner()) {
      return false;
    }

    // Cannot change own role
    if (!this.currentUser) {
      return false;
    }

    // Compare by email instead of ID to avoid type mismatch issues
    return member.email !== this.currentUser.email;
  }

  canRemoveMember(member: ProjectUser): boolean {
    if (!this.isOwner() || !this.currentUser) {
      return false;
    }

    // Cannot remove itself
    if (member.email === this.currentUser.email) {
      return false;
    }

    // Cannot remove another OWNER
    return member.role !== 'OWNER';
  }

  removeMember(memberId: string): void {
    if (!this.isOwner() || !this.projectToEdit) {
      return;
    }

    const memberToRemove = this.projectToEdit.usersDto.find(m => m.id === memberId);
    if (!memberToRemove) {
      return;
    }

    if (!this.canRemoveMember(memberToRemove)) {
      alert('You cannot remove this member.');
      return;
    }

    if (confirm('Are you sure you want to remove this member from the project?')) {
      this.projectService.removeTeamMember(memberId, this.projectToEdit.id).subscribe({
        next: () => {
          if (this.projectToEdit) {
            this.projectToEdit.usersDto = this.projectToEdit.usersDto.filter(
              member => member.id !== memberId
            );
          }
        },
        error: (error: any) => {
          console.error('Error removing member:', error);
          alert('Failed to remove member. Please try again.');
        }
      });
    }
  }

  openAddMemberModal(): void {
    this.showAddMemberModal = true;
  }

  cancelAddMember(): void {
    this.showAddMemberModal = false;
    this.newMemberEmail = '';
    this.newMemberRole = 'VIEWER';
  }

  closeAddMemberModal(event: MouseEvent): void {
    // Close the modal only if you clicked on the background (overlay)
    if (event.target === event.currentTarget) {
      this.cancelAddMember();
    }
  }

  // Edit Member Modal methods
  openEditMemberModal(member: ProjectUser): void {
    this.memberBeingEdited = member;
    this.editMemberEmail = member.email;
    this.editMemberRole = member.role;
    this.showEditMemberModal = true;
  }

  cancelEditMember(): void {
    this.showEditMemberModal = false;
    this.editMemberEmail = '';
    this.editMemberRole = 'VIEWER';
    this.memberBeingEdited = null;
  }

  closeEditMemberModal(event: MouseEvent): void {
    // Close the modal only if you clicked on the background (overlay)
    if (event.target === event.currentTarget) {
      this.cancelEditMember();
    }
  }

  addMember(): void {
    if (!this.newMemberEmail.trim() || !this.projectToEdit) {
      alert('Please enter a valid email address.');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.newMemberEmail)) {
      alert('Please enter a valid email address.');
      return;
    }

    // Check if member already exists
    const existingMember = this.projectToEdit.usersDto.find(
      member => member.email.toLowerCase() === this.newMemberEmail.toLowerCase()
    );
    if (existingMember) {
      alert('This user is already a member of the project.');
      return;
    }

    const teamMember = {
      projectId: this.projectToEdit.id,
      userEmail: this.newMemberEmail.trim(),
      roleProjectEnum: this.newMemberRole
    };


    this.projectService.addTeamMember(teamMember).subscribe({
      next: (response: any) => {
        if (this.projectToEdit && response.body) {
          // Convert backend response to frontend model
          const newMember = {
            id: response.body.id,
            email: response.body.email,
            firstName: response.body.firstName,
            lastName: response.body.lastName,
            role: response.body.role
          };
          this.projectToEdit.usersDto.push(newMember);
        }
        this.cancelAddMember();
      },
      error: (error: any) => {
        console.error('Error adding member:', error);
        const errorMessage = error.error?.message || 'Failed to add member. Please check the email and try again.';
        alert(errorMessage);
      }
    });
  }

  updateMember(): void {
    if (!this.editMemberEmail.trim() || !this.memberBeingEdited || !this.projectToEdit) {
      alert('Please enter a valid email address.');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.editMemberEmail)) {
      alert('Please enter a valid email address.');
      return;
    }

    // Check if email is being changed and if it already exists
    if (this.editMemberEmail.toLowerCase() !== this.memberBeingEdited.email.toLowerCase()) {
      const existingMember = this.projectToEdit.usersDto.find(
        member => member.email.toLowerCase() === this.editMemberEmail.toLowerCase()
      );
      if (existingMember) {
        alert('This email is already in use by another member.');
        return;
      }
    }

    console.log('Updating member:', {
      originalMember: this.memberBeingEdited,
      newEmail: this.editMemberEmail,
      newRole: this.editMemberRole
    });

    // For now, we'll just update the role since email change is complex
    // In a real scenario, email change would require backend API support
    if (this.editMemberRole !== this.memberBeingEdited.role) {
      const updateTeamMember = {
        projectId: this.projectToEdit.id,
        userId: this.memberBeingEdited.id,
        role: this.editMemberRole
      };

      this.projectService.updateTeamMember(updateTeamMember).subscribe({
        next: (response: any) => {
          if (this.projectToEdit && response.body && this.memberBeingEdited) {
            const index = this.projectToEdit.usersDto.findIndex(m => m.id === this.memberBeingEdited!.id);
            if (index !== -1) {
              // Update the member in the list
              this.projectToEdit.usersDto[index] = {
                id: response.body.id,
                email: response.body.email,
                firstName: response.body.firstName,
                lastName: response.body.lastName,
                role: response.body.role
              };
            }
          }
          this.cancelEditMember();
        },
        error: (error: any) => {
          console.error('Error updating member:', error);
          const errorMessage = error.error?.message || 'Failed to update member. Please try again.';
          alert(errorMessage);
        }
      });
    } else {
      // No role change, just close the modal
      this.cancelEditMember();
    }
  }

  updateMemberRole(member: ProjectUser, newRole: 'OWNER' | 'EDITOR' | 'VIEWER'): void {
    if (!this.isOwner() || !this.projectToEdit) {
      return;
    }

    // Não pode mudar o papel de si mesmo
    if (member.email === this.currentUser?.email) {
      return;
    }

    const updateTeamMember = {
      projectId: this.projectToEdit.id,
      userId: member.id,
      role: newRole
    };

    this.projectService.updateTeamMember(updateTeamMember).subscribe({
      next: (response: any) => {
        if (this.projectToEdit && response.body) {
          const index = this.projectToEdit.usersDto.findIndex(m => m.id === member.id);
          if (index !== -1) {
            // Convert backend response to frontend model
            this.projectToEdit.usersDto[index] = {
              id: response.body.id,
              email: response.body.email,
              firstName: response.body.firstName,
              lastName: response.body.lastName,
              role: response.body.role
            };
          }
        }
      },
      error: (error: any) => {
        console.error('Error updating member role:', error);
        const errorMessage = error.error?.message || 'Failed to update member role. Please try again.';
        alert(errorMessage);
        // Revert the role change in the UI by reloading data
        window.location.reload();
      }
    });
  }

  deleteProject(): void {
    if (!this.isOwner() || !this.projectToEdit) {
      return;
    }

    if (confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      this.projectService.deleteProject(this.projectToEdit.id).subscribe({
        next: () => {
          this.closeModal();
        },
        error: (error: any) => {
          console.error('Error deleting project:', error);
          alert('Failed to delete project. Please try again.');
        }
      });
    }
  }

  private validateForm(): boolean {
    if (!this.currentProject.name.trim()) {
      alert('Project name is required');
      return false;
    }

    if (!this.currentProject.description.trim()) {
      alert('Project description is required');
      return false;
    }

    return true;
  }

  private resetForm(): void {
    this.newProject = {
      name: '',
      description: '',
      userEmail: ''
    };

    this.editProject = {
      id: '',
      name: '',
      description: ''
    };

    this.showAddMemberModal = false;
    this.newMemberEmail = '';
    this.newMemberRole = 'VIEWER';

    this.showEditMemberModal = false;
    this.editMemberEmail = '';
    this.editMemberRole = 'VIEWER';
    this.memberBeingEdited = null;
  }

  private createProject(): void {
    if (!this.currentUser) {
      console.error('No user found');
      return;
    }

    this.newProject.userEmail = this.currentUser.email;

    this.projectService.createProject(this.newProject).subscribe({
      next: (project: any) => {
        if (!project?.id) {
          console.error('No project ID from project creation response');
          alert('Failed to create project. Please try again.');
          return;
        }

        const projectId = project.id;

        this.projectCreated.emit(projectId);
        this.closeModal();

        this.diagramService.createDiagram({ projectId }).subscribe({
          error: (error: any) => {
            console.error('Error creating diagram:', error);
          }
        });
      },
      error: (error: any) => {
        console.error('Error creating project:', error);
        alert('Failed to create project. Please try again.');
      }
    });
  }

  private updateProject(): void {
    this.projectService.updateProject(this.editProject).subscribe({
      next: () => this.closeModal(),
      error: (error: any) => {
        console.error('Error updating project:', error);
        alert('Failed to update project. Please try again.');
      }
    });
  }

}
