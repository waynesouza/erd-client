import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { Project, CreateProjectDto, UpdateProjectDto } from '../model/project.model';
import { TeamMember, AddTeamMemberDto, UpdateTeamMemberDto } from '../model/team-member.model';
import { environment } from '../../environments/environment';

const BASE_URL = `${environment.apiUrl}/project`;
const httpOptions = { headers: new HttpHeaders({'Content-Type': 'application/json'}) };

@Injectable({
  providedIn: 'root'
})
export class ProjectService {

  private selectedProject = new BehaviorSubject<string | null>(null);

  constructor(private http: HttpClient) { }

  createProject(project: CreateProjectDto): Observable<Project> {
    return this.http.post<Project>(BASE_URL, project, httpOptions);
  }

  getProjectsByUserEmail(email: string): Observable<Project[]> {
    return this.http.get<Project[]>(`${BASE_URL}/user-email/${email}`);
  }

  updateProject(project: UpdateProjectDto): Observable<Project> {
    return this.http.put<Project>(BASE_URL, project, httpOptions);
  }

  getProjectById(id: string): Observable<Project> {
    return this.http.get<Project>(`${BASE_URL}/${id}`);
  }

  getProjectMembers(projectId: string): Observable<TeamMember[]> {
    return this.http.get<TeamMember[]>(`${BASE_URL}/${projectId}/members`);
  }

  addTeamMember(teamMember: AddTeamMemberDto): Observable<any> {
    return this.http.post<any>(`${BASE_URL}/team-member`, teamMember, { ...httpOptions, observe: 'response' });
  }

  updateTeamMember(updateTeamMember: UpdateTeamMemberDto): Observable<any> {
    return this.http.put<any>(`${BASE_URL}/team-member`, updateTeamMember, { ...httpOptions, observe: 'response' });
  }

  removeTeamMember(memberId: string, projectId: string): Observable<void> {
    return this.http.delete<void>(`${BASE_URL}/team-member/${memberId}/project/${projectId}`);
  }

  deleteProject(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE_URL}/${id}`);
  }

}
