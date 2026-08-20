import { PayrollRepository } from "./payroll.repository";

export class PayrollService {
  private readonly repository = new PayrollRepository();

  constructor(private readonly serviceName: string) {}

  getStatus() {
    return {
      service: this.serviceName,
      ...this.repository.getModuleStatus(),
    };
  }
}
