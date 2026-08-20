export type EmployeesModuleStatus = {
  status: 'ok';
  module: 'employees';
};

export class EmployeesRepository {
  getModuleStatus(): EmployeesModuleStatus {
    return { status: 'ok', module: 'employees' };
  }
}
