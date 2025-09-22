import { Injectable } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { catchError, Observable, switchMap, throwError } from 'rxjs';
import { StorageService } from '../service/storage.service';
import { EventBusService } from '../shared/event-bus.service';
import { EventData } from '../shared/event.class';
import { AuthService } from '../service/auth.service';
import { Router } from '@angular/router';

@Injectable()
export class JwtInterceptor implements HttpInterceptor {
  private isRefreshing = false;

  constructor(private authService: AuthService, private storageService: StorageService,
              private eventBusService: EventBusService, private router: Router) { }

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    console.log('JWT Interceptor - Request URL:', request.url);
    console.log('JWT Interceptor - Headers before:', request.headers.keys());

    // Clone request with credentials for cookie-based auth
    request = request.clone({
      withCredentials: true
    });

    console.log('JWT Interceptor - withCredentials set to:', request.withCredentials);

    return next.handle(request)
      .pipe(catchError((error) => {
        if (error instanceof HttpErrorResponse) {
          // Check if its a 401 error and not a login or refresh request
          if (error.status === 401 && 
              !request.url.includes('/auth/login') && 
              !request.url.includes('/auth/refresh-token')) {
            return this.handleUnauthorized(request, next);
          }
          
          // If its a 401 error on refresh token, perform logout
          if (error.status === 401 && request.url.includes('/auth/refresh-token')) {
            console.log('Refresh token expired, logging out user');
            this.performLogout();
            return throwError(() => error);
          }
          
          if (error.status === 403) {
            // Access denied - redirect to main page
            this.router.navigate(['/diagram']).then();
            this.eventBusService.emit(new EventData('access-denied', null));
          }
        }

        return throwError(() => error);
      }));
  }

  private handleUnauthorized(request: HttpRequest<any>, next: HttpHandler) {
    if (!this.isRefreshing) {
      this.isRefreshing = true;

      if (this.storageService.isLoggedIn()) {
        console.log('Attempting to refresh token...');
        return this.authService.refreshToken()
          .pipe(
            switchMap((response) => {
              this.isRefreshing = false;
              console.log('Token refresh successful:', response);
              // Retry the original request after refreshing token
              return next.handle(request);
            }),
            catchError((error) => {
              this.isRefreshing = false;
              console.error('Token refresh failed:', error);
              
              // Somente fazer logout se o refresh token realmente falhou
              if (error.status === 401 || error.status === 403) {
                this.performLogout();
              }

              return throwError(() => error);
            })
          );
      } else {
        this.isRefreshing = false;
        this.router.navigate(['/login']).then();
      }
    }

    return throwError(() => new Error('Unauthorized'));
  }

  private performLogout(): void {
    console.log('Performing logout due to authentication failure');
    this.storageService.clean();
    this.authService.setLoggedIn(false);
    this.router.navigate(['/login']).then();
    this.eventBusService.emit(new EventData('logout', null));
  }

}
