export type AuthModuleStatus = {
  status: 'ok';
  module: 'auth';
};

export class AuthRepository {
  getModuleStatus(): AuthModuleStatus {
    return { status: 'ok', module: 'auth' };
  }
}
