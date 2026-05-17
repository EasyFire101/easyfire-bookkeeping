import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';

export const ATTACHMENTS_ROUTES = {
  LIST: '/api/attachments',
  BY_ID: '/api/attachments/{id}',
  PRESIGNED_URL: '/api/attachments/{id}/presigned-url',
} as const satisfies Record<string, keyof paths>;

/** Response shape from POST /api/attachments (upload). Schema may not define it; server returns { data }. */
export interface UploadAttachmentResponse {
  id: number;
  key: string;
  mimeType: string;
  originName: string;
  size: number;
  createdAt: string;
}

/**
 * Upload an attachment via multipart/form-data. Uses the fetcher's baseUrl and init (headers).
 * The OpenAPI client may not support FormData, so we use fetch with the same config.
 */
export async function uploadAttachment(
  fetcher: ApiFetcher,
  formData: FormData
): Promise<UploadAttachmentResponse> {
  const post = fetcher.path(ATTACHMENTS_ROUTES.LIST).method('post').create();
  // Generated client expects typed body; FormData is valid for multipart/form-data at runtime
  const res = await (
    post as unknown as (body: FormData) => Promise<{ data?: { data?: UploadAttachmentResponse } }>
  )(formData);
  const data = (res as { data?: { data?: UploadAttachmentResponse } })?.data?.data;
  if (!data) {
    throw new Error('Upload attachment: no data in response');
  }
  return data;
}

export async function deleteAttachment(fetcher: ApiFetcher, id: string): Promise<void> {
  const del = fetcher.path(ATTACHMENTS_ROUTES.BY_ID).method('delete').create();
  await del({ id });
}

export async function fetchAttachmentPresignedUrl(
  fetcher: ApiFetcher,
  id: string
): Promise<unknown> {
  const get = fetcher.path(ATTACHMENTS_ROUTES.PRESIGNED_URL).method('get').create();
  const { data } = await get({ id });
  return data;
}
