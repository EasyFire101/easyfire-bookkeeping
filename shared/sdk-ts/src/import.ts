import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';

export const IMPORT_ROUTES = {
  FILE: '/api/import/file',
  MAPPING: '/api/import/{import_id}/mapping',
  PREVIEW: '/api/import/{import_id}/preview',
  IMPORT: '/api/import/{import_id}/import',
  SAMPLE: '/api/import/sample',
  META: '/api/import/{import_id}',
} as const satisfies Record<string, keyof paths>;

export interface ImportMappingBody {
  mapping: Array<{ group?: string; from: string; to: string }>;
}

export interface ImportPreviewResponse {
  [key: string]: unknown;
}

export interface ImportFileMetaResponse {
  [key: string]: unknown;
}

export interface ImportProcessResponse {
  resource?: string;
  [key: string]: unknown;
}

export async function fetchImportPreview(
  fetcher: ApiFetcher,
  importId: string
): Promise<ImportPreviewResponse> {
  const get = fetcher
    .path(IMPORT_ROUTES.PREVIEW)
    .method('get')
    .create();
  const { data } = await get({ import_id: importId } as never);
  return (data ?? {}) as ImportPreviewResponse;
}

export async function fetchImportFileMeta(
  fetcher: ApiFetcher,
  importId: string
): Promise<ImportFileMetaResponse> {
  const get = fetcher.path(IMPORT_ROUTES.META).method('get').create();
  const { data } = await get({ import_id: importId } as never);
  return (data ?? {}) as ImportFileMetaResponse;
}

export async function importMapping(
  fetcher: ApiFetcher,
  importId: string,
  body: ImportMappingBody
): Promise<void> {
  const post = fetcher
    .path(IMPORT_ROUTES.MAPPING)
    .method('post')
    .create();
  await post({ import_id: importId, ...body } as never);
}

export async function importProcess(
  fetcher: ApiFetcher,
  importId: string
): Promise<ImportProcessResponse> {
  const post = fetcher.path(IMPORT_ROUTES.IMPORT).method('post').create();
  const { data } = await post({ import_id: importId } as never);
  return (data ?? {}) as ImportProcessResponse;
}
