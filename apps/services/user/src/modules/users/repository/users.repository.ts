import type { UsersModuleStatus } from "./types/repository.types";

export class UsersRepository {
  getModuleStatus(): UsersModuleStatus {
    return { status: "ok", module: "users" };
  }
}
