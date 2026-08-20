export type ReportsModuleStatus = {
  status: 'ok';
  module: 'reports';
};

export class ReportingRepository {
  getModuleStatus(): ReportsModuleStatus {
    return { status: 'ok', module: 'reports' };
  }
}
