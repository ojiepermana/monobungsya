import { ReportingRepository } from "./reporting.repository";

export class ReportingService {
  private readonly repository = new ReportingRepository();

  constructor(private readonly serviceName: string) {}

  getStatus() {
    return {
      service: this.serviceName,
      ...this.repository.getModuleStatus(),
    };
  }
}
