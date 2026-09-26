export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface LoginCredentials {
  email: string;
  password?: string;
}

export interface RegisterData {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
}

export interface AuthResponse {
  accessToken?: string;
  user?: User;
}
