export type UserCreatedEvent = {
  type: "user.created";
  version: 1;
  occurredAt: string;
  userId: string;
};

export type UserUpdatedEvent = {
  type: "user.updated";
  version: 1;
  occurredAt: string;
  userId: string;
};

export type UserDeletedEvent = {
  type: "user.deleted";
  version: 1;
  occurredAt: string;
  userId: string;
};

export type EmployeeCreatedEvent = {
  type: "employee.created";
  version: 1;
  occurredAt: string;
  employeeId: string;
};

export type PayrollRunCompletedEvent = {
  type: "payroll.run.completed";
  version: 1;
  occurredAt: string;
  payrollRunId: string;
};
