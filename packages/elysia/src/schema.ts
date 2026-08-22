import { t } from 'elysia';

/**
 * A closed set of allowed string values, safe to use on an optional property.
 *
 * Why this exists: `t.UnionEnum(values)` stamps `default: values[0]` onto the
 * schema it returns, and Elysia fills a missing property from a schema default
 * even when the property is optional. On a PATCH body that turns "the client
 * did not send this field" into "the client sent the first value in the list",
 * which silently overwrites stored data. Spec
 * docs/specs/0007-user-management hit exactly that: a PATCH carrying only a
 * name arrived with `role` set to the first role, promoting the user to admin.
 *
 * This wrapper is the same union with that default removed, so an absent
 * optional property stays absent and a handler can tell the two apart. Reach
 * for it instead of `t.UnionEnum` whenever the property may be optional; there
 * is no downside when it is required.
 */
export function enumSchema<const T extends readonly [string, ...string[]]>(
  values: T,
) {
  const schema = t.UnionEnum(values);

  delete (schema as { default?: unknown }).default;

  return schema;
}
