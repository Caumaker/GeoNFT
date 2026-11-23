'use strict';
const Ajv = require('ajv');
const schema = require('../../schema/geonft-metadata.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(schema);

function validate(metadata) {
  const ok = check(metadata);
  return { ok, errors: ok ? [] : check.errors.map((e) => `${e.instancePath || '/'} ${e.message}`) };
}

module.exports = { validate };
