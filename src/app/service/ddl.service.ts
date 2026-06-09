import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const BASE_URL = `${environment.apiUrl}/ddl`;
const httpOptions = { headers: new HttpHeaders({'Content-Type': 'application/json'}) };

export interface ExportDdlResponse {
  ddlContent: string;
  projectId: string;
}

export interface ImportDdlRequest {
  projectId: string;
  ddlContent: string;
}

@Injectable({
  providedIn: 'root'
})
export class DdlService {

  constructor(private http: HttpClient) { }

  exportDdl(projectId: string): Observable<ExportDdlResponse> {
    return this.http.get<ExportDdlResponse>(`${BASE_URL}/export/${projectId}`, httpOptions);
  }

  importDdl(request: ImportDdlRequest): Observable<void> {
    return this.http.post<void>(`${BASE_URL}/import`, request, httpOptions);
  }

  downloadSqlFile(ddlContent: string, filename: string = 'diagram.sql'): void {
    const blob = new Blob([ddlContent], { type: 'application/sql' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  readSqlFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        resolve(content);
      };
      reader.onerror = (error) => {
        reject(error);
      };
      reader.readAsText(file);
    });
  }

}
