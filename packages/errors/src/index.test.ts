import { describe, expect, it } from 'bun:test';
import {
  AppError,
  ConflictError,
  NotFoundError,
  toErrorResponse,
} from './index';

describe('ConflictError', () => {
  it('defaults to a generic message with no reason', () => {
    const error = new ConflictError();

    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.reason).toBeUndefined();
  });

  it('carries a machine readable reason alongside a custom message', () => {
    // Spec docs/specs/0007-user-management AC-1: a duplicate id and a
    // duplicate email must both stay a 409 CONFLICT but be told apart.
    const error = new ConflictError(
      'A user with this id already exists',
      'user_id_taken',
    );

    expect(error.message).toBe('A user with this id already exists');
    expect(error.reason).toBe('user_id_taken');
  });
});

describe('toErrorResponse', () => {
  it('includes the reason in the envelope when the error carries one', () => {
    const { status, body } = toErrorResponse(
      new ConflictError(
        'A user with this email already exists',
        'user_email_taken',
      ),
    );

    expect(status).toBe(409);
    expect(body.error).toEqual({
      code: 'CONFLICT',
      message: 'A user with this email already exists',
      reason: 'user_email_taken',
    });
  });

  it('omits the reason key entirely when the error carries none', () => {
    const { body } = toErrorResponse(new NotFoundError('User not found'));

    expect(body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'User not found',
    });
    expect(body.error).not.toHaveProperty('reason');
  });

  it('adds the requestId only when one is passed', () => {
    const withId = toErrorResponse(new NotFoundError(), 'request-123');
    const withoutId = toErrorResponse(new NotFoundError());

    expect(withId.body.error.requestId).toBe('request-123');
    expect(withoutId.body.error).not.toHaveProperty('requestId');
  });

  it('falls back to a 500 internal error for anything that is not an AppError', () => {
    const { status, body } = toErrorResponse(new Error('unexpected'));

    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('keeps AppError subclasses distinguishable by status and code', () => {
    // A guard against reason leaking onto codes that never set one.
    const notFound = toErrorResponse(new NotFoundError());
    const generic = toErrorResponse(
      new AppError('VALIDATION_ERROR', 422, 'bad input'),
    );

    expect(notFound.status).toBe(404);
    expect(generic.status).toBe(422);
    expect(generic.body.error).not.toHaveProperty('reason');
  });
});
