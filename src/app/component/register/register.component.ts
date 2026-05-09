import { Component } from '@angular/core';
import { RegisterModel } from '../../model/register.model';
import { AuthService } from '../../service/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {

  register: RegisterModel = {
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: 'USER'
  };
  isSuccessful = false;
  isSignUpFailed = false;
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  constructor(private authService: AuthService, private router: Router) { }

  onSubmit() {
    this.isLoading = true;
    this.isSignUpFailed = false;
    this.errorMessage = '';
    
    this.authService.register(this.register).subscribe({
      next: () => {
        this.isSuccessful = true;
        this.isSignUpFailed = false;
        this.isLoading = false;
        this.successMessage = 'Conta criada com sucesso! Verificamos também seu email. Redirecionando para o login...';
        
        // Redirect after showing success message
        setTimeout(() => {
          this.router.navigate(['/login']).then();
        }, 3000);
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.error?.message || err.error || 'Erro ao criar conta. Tente novamente.';
        this.isSignUpFailed = true;
      }
    });
  }

}
