# Project Guidelines

## Repository Context

- For questions about this repository's architecture, code relationships, or project content, use the project Graphify skill first.
- When `graphify-out/graph.json` exists, query the graph before broad raw-file searches; cite the graph's `source_location` when using a specific fact.
- When the graph does not exist or does not contain enough context, run `/graphify .` or continue with targeted repository searches as needed.

## Docker Usage

- Do not use Docker or Docker Compose to run local development infrastructure or services.
- Use the local development services and commands documented by the repository for development and runtime verification.
- Use Docker only to test Dockerfiles and validate built images, including image-level smoke tests.

## Completed Spec Slices

- When a slice from a `docs/specs/` build plan is complete and its required validation passes, identify the exact files belonging to that slice, including spec or scope progress updates. Keep unrelated pre-existing changes out of the slice.
- Run `graphify update .` (equivalent to `/graphify . --update`) and confirm it succeeds so the graph re-extracts the new or changed files.
- After a successful update, stage and commit only the slice files using a one-line English Conventional Commit subject. Leave `graphify-out/` ignored unless a tracked graph artifact is explicitly part of the slice.
- If the Graphify update fails, leave the slice uncommitted, report the failure, and retry the update before committing.

## Graph Updates Before Push

- Before running `git push`, run `graphify update .` (equivalent to `/graphify . --update`) and confirm it succeeds.
- Do not run `git push` if the Graphify update fails; report the failure instead.
