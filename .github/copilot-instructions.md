# Project Guidelines

## Repository Context

- For questions about this repository's architecture, code relationships, or project content, use the project Graphify skill first.
- When `graphify-out/graph.json` exists, query the graph before broad raw-file searches; cite the graph's `source_location` when using a specific fact.
- When the graph does not exist or does not contain enough context, run `/graphify .` or continue with targeted repository searches as needed.

## Graph Updates Before Push

- Before running `git push`, run `graphify update .` (equivalent to `/graphify . --update`) and confirm it succeeds.
- Do not run `git push` if the Graphify update fails; report the failure instead.
