export type PayrollModuleStatus = {
  status: 'ok';
  module: 'payroll';
};

export class PayrollRepository {
  getModuleStatus(): PayrollModuleStatus {
    return { status: 'ok', module: 'payroll' };
  }
}
