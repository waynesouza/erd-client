import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, tap, catchError, throwError } from 'rxjs';
import { RegisterModel } from '../model/register.model';
import { LoginModel } from '../model/login.model';
import { StorageService } from './storage.service';
import { environment } from '../../environments/environment';

const BASE_URL = environment.apiUrl;
const httpOptions = { 
  headers: new HttpHeaders({'Content-Type': 'application/json'}),
  withCredentials: true // Ensure cookies are sent
};

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private loggedInSubject = new BehaviorSubject<boolean>(false);
  public loggedIn$ = this.loggedInSubject.asObservable();

  constructor(private http: HttpClient, private storageService: StorageService) {
    // Initialize with current login status
    this.loggedInSubject.next(this.storageService.isLoggedIn());
  }

  get isLoggedIn(): boolean {
    return this.storageService.isLoggedIn();
  }

  setLoggedIn(status: boolean): void {
    this.loggedInSubject.next(status);
  }

  login(login: LoginModel): Observable<any> {
    return this.http.post<any>(`${BASE_URL}/auth/login`, login, httpOptions).pipe(
      tap((response) => {
        console.log('Login successful:', response);
        this.setLoggedIn(true);
      }),
      catchError((error) => {
        console.error('Login failed:', error);
        this.setLoggedIn(false);
        return throwError(() => error);
      })
    );
  }

  register(register: RegisterModel): Observable<any> {
    return this.http.post<any>(`${BASE_URL}/user`, register, httpOptions);
  }

  logout(): Observable<any> {
    return this.http.post<any>(`${BASE_URL}/auth/logout`, {}, httpOptions).pipe(
      tap(() => {
        console.log('Logout successful');
        this.storageService.clean();
        this.setLoggedIn(false);
      }),
      catchError((error) => {
        console.error('Logout error:', error);
        // Even if the logout fails on the server, clean local data
        this.storageService.clean();
        this.setLoggedIn(false);
        return throwError(() => error);
      })
    );
  }

  refreshToken(): Observable<any> {
    console.log('AuthService: Attempting to refresh token...');
    return this.http.post<any>(`${BASE_URL}/auth/refresh-token`, {}, httpOptions).pipe(
      tap((response) => {
        console.log('AuthService: Token refresh successful:', response);
        // The token is automatically updated via HTTP-only cookies
        // We dont need to do anything specific here except keep the logged in state
        this.setLoggedIn(true);
      }),
      catchError((error) => {
        console.error('AuthService: Token refresh failed:', error);
        
        // If the refresh token fails, the user needs to login again
        if (error.status === 401 || error.status === 403) {
          console.log('AuthService: Refresh token expired, user needs to login again');
          this.storageService.clean();
          this.setLoggedIn(false);
        }
        
        return throwError(() => error);
      })
    );
  }

}
