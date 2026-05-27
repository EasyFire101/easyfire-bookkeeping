import {
  useMutation,
  useQuery,
  useQueryClient,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';
import type {
  ItemCategory,
  ItemCategoriesListResponse,
  ItemsCategoriesListResult,
  CreateItemCategoryBody,
  EditItemCategoryBody,
} from '@bigcapital/sdk-ts';
import {
  fetchItemCategories,
  fetchItemCategory,
  createItemCategory,
  editItemCategory,
  deleteItemCategory,
} from '@bigcapital/sdk-ts';
import { useApiFetcher } from '../../useRequest';
import { itemsCategoriesKeys } from './query-keys';

const commonInvalidateQueries = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: itemsCategoriesKeys.all() });
};


/**
 * Creates a new item category.
 */
export function useCreateItemCategory(
  props?: UseMutationOptions<void, Error, CreateItemCategoryBody>
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: (values: CreateItemCategoryBody) =>
      createItemCategory(fetcher, values),
    onSuccess: () => commonInvalidateQueries(queryClient),
  });
}

/**
 * Edits the item category.
 */
export function useEditItemCategory(
  props?: UseMutationOptions<void, Error, [number, EditItemCategoryBody]>
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: ([id, values]: [number, EditItemCategoryBody]) =>
      editItemCategory(fetcher, id, values),
    onSuccess: (_data, [id]) => {
      queryClient.invalidateQueries({ queryKey: itemsCategoriesKeys.detail(id) });
      commonInvalidateQueries(queryClient);
    },
  });
}

/**
 * Deletes the given item category.
 */
export function useDeleteItemCategory(
  props?: UseMutationOptions<void, Error, number>
) {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher();

  return useMutation({
    ...props,
    mutationFn: (id: number) => deleteItemCategory(fetcher, id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: itemsCategoriesKeys.detail(id) });
      commonInvalidateQueries(queryClient);
    },
  });
}

function transformCategories(data: ItemCategoriesListResponse): ItemsCategoriesListResult {
  const arr = Array.isArray(data) ? data : (data as { data?: ItemCategory[] })?.data ?? [];
  const pagination = (data as { pagination?: Record<string, unknown> })?.pagination ?? {};
  return {
    itemsCategories: arr as ItemCategory[],
    pagination,
  };
}

/**
 * Retrieve the items categories.
 */
export function useItemsCategories(
  query?: Record<string, unknown>,
  props?: Omit<
    UseQueryOptions<ItemCategoriesListResponse, Error, ItemsCategoriesListResult>,
    'queryKey' | 'queryFn' | 'select'
  >
) {
  const fetcher = useApiFetcher();
  return useQuery<ItemCategoriesListResponse, Error, ItemsCategoriesListResult>({
    ...props,
    queryKey: [...itemsCategoriesKeys.all(), query],
    queryFn: () => fetchItemCategories(fetcher),
    select: transformCategories,
  });
}

/**
 * Retrieve the item category details.
 */
export function useItemCategory(
  id: number | null | undefined,
  props?: Omit<UseQueryOptions<ItemCategory>, 'queryKey' | 'queryFn'>
) {
  const fetcher = useApiFetcher();
  return useQuery({
    ...props,
    queryKey: itemsCategoriesKeys.detail(id),
    queryFn: () => fetchItemCategory(fetcher, id!),
    enabled: id != null,
  });
}
