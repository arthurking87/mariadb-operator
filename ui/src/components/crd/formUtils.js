// Sets a (possibly nested, dot-path) key on an object, creating intermediate objects as
// needed. Used to translate flat form values into the nested CR spec shape without every
// schema having to hand-write its own spec builder.
export function setPath(obj, path, value) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] ?? {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

// Kubernetes object names must be lowercase RFC 1123 labels — no camelCase. Field keys are
// plain JS identifiers (e.g. `s3AccessKeyId`) for convenience, so anything derived from a
// field key into an actual k8s object name (Secret names built from `<resource>-<fieldKey>`)
// needs to go through this first.
export function slugify(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

// True unless the field declares showIf and it evaluates false for the current values —
// i.e. a field with no showIf is always visible/active.
export function fieldActive(field, values) {
  return !field.showIf || field.showIf(values)
}

// Builds spec from a schema's flat `fields` list when the schema doesn't provide its own
// `buildSpec`. Handles the common cases: scalar fields (optionally at a nested specField
// path), password fields (which become a *SecretKeyRef pointing at a Secret created
// separately, looked up in ctx.secretNames by field key since a schema can have more than
// one password field), skips fields hidden by `showIf`, and skips empty optional values.
export function genericBuildSpec(schema, values, ctx) {
  const spec = {}
  if (schema.scope === 'instance' && !schema.standalone) {
    spec.mariaDbRef = { name: ctx.instanceName }
  }
  for (const f of schema.fields) {
    if (f.key === 'name') continue
    if (!fieldActive(f, values)) continue
    if (f.type === 'password') {
      setPath(spec, f.specField, { name: ctx.secretNames[f.key], key: f.secretKey })
      continue
    }
    let val = values[f.key]
    if (val === undefined || val === '' || val === null) continue
    if (f.type === 'number') val = Number(val)
    setPath(spec, f.specField || f.key, val)
  }
  return spec
}

export function initialValues(schema) {
  const values = {}
  for (const f of schema.fields) {
    if (f.default !== undefined) values[f.key] = f.default
    else if (f.type === 'multiselect') values[f.key] = []
    else if (f.type === 'boolean') values[f.key] = false
    else values[f.key] = ''
  }
  return values
}
