import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../services/auth.service';
import { SignupComponent } from './signup.component';

describe('SignupComponent', () => {
  let fixture: ComponentFixture<SignupComponent>;
  let register: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    register = vi.fn(() => of(undefined));
    await TestBed.configureTestingModule({
      imports: [SignupComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: { register } }],
    }).compileComponents();
    fixture = TestBed.createComponent(SignupComponent);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('adapts the full-name form to the current DTO and redirects registration to Home', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    Object.assign(fixture.componentInstance, {
      fullName: 'Mona Ali', email: 'mona@example.com', password: 'password1', confirmPassword: 'password1',
    });
    fixture.componentInstance.onRegister();
    expect(register).toHaveBeenCalledWith({ firstName: 'Mona', lastName: 'Ali', email: 'mona@example.com', password: 'password1' });
    expect(navigate).toHaveBeenCalledWith(['/home']);
  });
});
