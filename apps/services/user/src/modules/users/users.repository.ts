export type UsersModuleStatus = {
  status: "ok";
  module: "users";
};

export class UsersRepository {
  getModuleStatus(): UsersModuleStatus {
    return { status: "ok", module: "users" };
  }
}
