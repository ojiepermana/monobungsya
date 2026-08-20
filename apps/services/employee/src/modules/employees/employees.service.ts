import { EmployeesRepository } from './employees.repository';

export class EmployeesService {
  private readonly repository = new EmployeesRepository();

  constructor(private readonly serviceName: string) {}

  getStatus() {
    return {
      service: this.serviceName,
      ...this.repository.getModuleStatus(),
    };
  }
}
