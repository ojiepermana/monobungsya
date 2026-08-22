/**
 * Published by the user service after a create commits, consumed by the auth
 * service to send the new user an invitation magic link
 * (spec docs/specs/0007-user-management, AC-2). The subject is a constant here
 * so publisher and subscriber can never drift.
 */
export const USER_INVITED_SUBJECT = 'user.invited';

export type UserInvitedEvent = {
  type: 'user.invited';
  version: 1;
  occurredAt: string;
  userId: string;
  email: string;
  name: string;
  /** Id of the admin who created the user, taken from the verified identity. */
  requestedBy: string;
};

export type UserCreatedEvent = {
  type: 'user.created';
  version: 1;
  occurredAt: string;
  userId: string;
};

export type UserUpdatedEvent = {
  type: 'user.updated';
  version: 1;
  occurredAt: string;
  userId: string;
};

export type UserDeletedEvent = {
  type: 'user.deleted';
  version: 1;
  occurredAt: string;
  userId: string;
};

export type EmployeeCreatedEvent = {
  type: 'employee.created';
  version: 1;
  occurredAt: string;
  employeeId: string;
};

export type PayrollRunCompletedEvent = {
  type: 'payroll.run.completed';
  version: 1;
  occurredAt: string;
  payrollRunId: string;
};
