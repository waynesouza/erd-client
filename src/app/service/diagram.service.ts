import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DiagramModel } from '../model/diagram.model';
import { environment } from '../../environments/environment';

const BASE_URL = `${environment.apiUrl}/diagram`;
const httpOptions = { headers: new HttpHeaders({'Content-Type': 'application/json'}) };

@Injectable({
  providedIn: 'root'
})
export class DiagramService {

  constructor(private http: HttpClient) { }

  createDiagram(diagram: any): Observable<DiagramModel> {
    return this.http.post<DiagramModel>(`${BASE_URL}`, diagram, httpOptions);
  }

  getDiagram(projectId: string): Observable<DiagramModel> {
    return this.http.get<DiagramModel>(`${BASE_URL}/${projectId}`, httpOptions);
  }

}
