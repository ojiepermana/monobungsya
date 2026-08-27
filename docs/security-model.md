# Security Model

Monobungsya uses magic-link authentication, server-side sessions, and native
bearer tokens for desktop clients.

- `users.manage` controls user administration.
- `logs.read` controls Audit Trail access.
- Authentication and authorization are enforced in backend services.
- Sessions are revoked on logout and protected by the configured idle timeout.
- The API uses security headers, trusted-origin checks, and bearer-session
  handling through shared plugins.

Secrets and database credentials are supplied through runtime environment
configuration and are never stored in the frontend bundle.
