/**
 * @data-dictionary/format: the contract for the content files of a data
 * dictionary repository (concept sets, projects, units…), shared by v1, v2 and
 * Linkr. JSON Schemas in ../schemas, with a byte-exact serializer: for every
 * file written by the tools, `serialize(parse(text), {kind}) === text`.
 */
export { FILE_KINDS, TRAILING_NEWLINE, kindForPath, type FileKind } from './kinds.ts'
export { RawNumber, isRawNumber, toNumber, toPlain, type JsonNumber } from './number.ts'
export { parse } from './parse.ts'
export { serialize, type SerializeOptions } from './serialize.ts'
export {
  SCHEMAS,
  DictionaryFormatError,
  assertValid,
  formatIssues,
  validate,
  validateFile,
  type ValidationIssue,
  type ValidationResult,
} from './validate.ts'
export * from './types.ts'
