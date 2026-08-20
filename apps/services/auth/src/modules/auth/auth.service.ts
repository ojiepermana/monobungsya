import { AuthRepository } from './auth.repository';

export class AuthService {
  private readonly repository = new AuthRepository();

  constructor(private readonly serviceName: string) {}

  getStatus() {
    return {
      service: this.serviceName,
      ...this.repository.getModuleStatus(),
    };
  }
}
