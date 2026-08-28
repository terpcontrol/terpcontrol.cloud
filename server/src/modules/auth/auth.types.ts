/**
 * What the user-facing services take. Requests are validated against the Zod
 * schemas at the HTTP edge; these describe the shape that reaches the service.
 */
export interface LoginDto {
  username: string;
  password: string;
  stayLoggedIn?: boolean;
}

export interface SignupDto {
  username: string;
  password: string;
}

export interface ActivationDto {
  activation_code: string;
}

export interface PasswordResetDto {
  password: string;
  token: string;
}

export interface CreateUserDto {
  username: string;
  password: string;
  is_admin: boolean;
}
