ALTER ROLE project_observability_writer SETTINGS async_insert = 1 CONST, wait_for_async_insert = 1 CONST, async_insert_deduplicate = 1 CONST, insert_deduplicate = 1 CONST
