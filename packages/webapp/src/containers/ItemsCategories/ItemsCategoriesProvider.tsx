import React, { createContext } from 'react';
import { DashboardInsider } from '@/components';
import { useItemsCategories, useResourceMeta } from '@/hooks/query';
import { transformTableStateToQuery, getFieldsFromResourceMeta } from '@/utils';
import type { ItemCategoryTableRow } from './components';

interface ItemsCategoriesProviderProps {
  // The store-injected `itemsCategoriesTableState` is a complex selector return;
  // keep it loose to avoid SDK-shape friction.
  tableState: Record<string, unknown>;
  children?: React.ReactNode;
}

export interface ItemsCategoriesContextValue {
  isCategoriesFetching: boolean;
  isCategoriesLoading: boolean;
  fields: unknown[];
  // `resourceMeta` is a complex SDK union; surface as `any` (matches Invoices
  // pattern).
  resourceMeta: any;
  isResourceLoading: boolean;
  isResourceFetching: boolean;
  // FIXME: response shape mismatch — `ItemCategoriesListResponse` is the array
  // type but the original code reads `.itemsCategories`/`.pagination`. Preserved
  // from @ts-nocheck original; both are `undefined` at runtime.
  itemsCategories: ItemCategoryTableRow[] | undefined;
  pagination: { total?: number; [key: string]: unknown } | undefined;
  query: ReturnType<typeof transformTableStateToQuery>;
}

const ItemsCategoriesContext = createContext<ItemsCategoriesContextValue>(
  {} as ItemsCategoriesContextValue,
);

/**
 * Items categories provider.
 */
function ItemsCategoriesProvider({
  tableState,
  ...props
}: ItemsCategoriesProviderProps) {
  // Transformes the table state to query.
  const query = transformTableStateToQuery(tableState);

  // Items categories list.
  const {
    data: itemsCategoriesDataRaw,
    isFetching: isCategoriesFetching,
    isLoading: isCategoriesLoading,
  } = useItemsCategories(query);
  // FIXME: see interface note — SDK schema is wrong about response shape.
  const itemsCategoriesData =
    itemsCategoriesDataRaw as unknown as
      | {
          itemsCategories?: ItemCategoryTableRow[];
          pagination?: { total?: number; [key: string]: unknown };
        }
      | undefined;

  // Fetch the accounts resource fields.
  const {
    data: resourceMeta,
    isLoading: isResourceLoading,
    isFetching: isResourceFetching,
  } = useResourceMeta('item_category');

  const state: ItemsCategoriesContextValue = {
    isCategoriesFetching,
    isCategoriesLoading,

    fields: resourceMeta?.fields
      ? getFieldsFromResourceMeta(resourceMeta.fields)
      : [],
    resourceMeta,
    isResourceLoading,
    isResourceFetching,

    itemsCategories: itemsCategoriesData?.itemsCategories,
    pagination: itemsCategoriesData?.pagination,
    query,
  };

  return (
    <DashboardInsider
      // `DashboardInsider` accepts `loading`, not `isLoading` — the original
      // `isLoading` was always ignored (latent bug preserved).
      // @ts-expect-error see comment above
      isLoading={isResourceLoading}
      name={'items-categories-list'}
    >
      <ItemsCategoriesContext.Provider value={state} {...props} />
    </DashboardInsider>
  );
}

const useItemsCategoriesContext = () =>
  React.useContext(ItemsCategoriesContext);

export { ItemsCategoriesProvider, useItemsCategoriesContext };
