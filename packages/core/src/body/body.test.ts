// SPDX-License-Identifier: MIT
// packages/core/src/body/body.test.ts
// Exercises: BODY-11/TRANSPORT-28 (FileBodyDescriptor recognition contract)
import {describe, expect, test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {Body, FileBodyDescriptor} from './body.js';

describe('FileBodyDescriptor (BODY-11/TRANSPORT-28 recognition contract)', () => {
  test('is a Body with a discriminated file kind and structural fields', () => {
    expectTypeOf<FileBodyDescriptor>().toExtend<Body>();
    expectTypeOf<FileBodyDescriptor['kind']>().toEqualTypeOf<'file'>();
    expectTypeOf<FileBodyDescriptor['path']>().toEqualTypeOf<string>();
    expectTypeOf<FileBodyDescriptor['start']>().toEqualTypeOf<number>();
    expectTypeOf<FileBodyDescriptor['count']>().toEqualTypeOf<number>();
  });

  test("Body['kind'] accepts 'file' without a cast", () => {
    const kind: Body['kind'] = 'file';
    expect(kind).toBe('file');
  });
});
