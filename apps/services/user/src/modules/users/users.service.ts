import { UsersRepository } from "./users.repository";

export class UsersService {
  private readonly repository = new UsersRepository();

  constructor(private readonly serviceName: string) {}

  getStatus() {
    return {
      service: this.serviceName,
      ...this.repository.getModuleStatus(),
    };
  }
}
