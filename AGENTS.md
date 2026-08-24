# Repository Instructions

## Docker Usage

- Do not use Docker or Docker Compose to run local development infrastructure or services.
- Use the local development services and commands documented by the repository for development and runtime verification.
- Use Docker only to test Dockerfiles and validate built images, including image-level smoke tests.

## Workflow Progress

- Treat `docs/scope/scope.md` and `docs/specs/` as the source of truth; `docs/progress.md` is generated and must not be edited by hand.
- After changing scope, specs, verification plans, or their code pointers, run `bun run progress:generate` and `bun run progress:check`.
