import { ulid } from 'ulid';
/** Prefixed ULIDs: newId('tr') -> "tr_01J..." */
export const newId = (prefix: string) => `${prefix}_${ulid()}`;
