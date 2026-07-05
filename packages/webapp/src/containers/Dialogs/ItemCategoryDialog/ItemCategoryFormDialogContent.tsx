// @ts-nocheck
import React from 'react';
import { ItemCategoryForm } from './ItemCategoryForm';
import { ItemCategoryProvider } from './ItemCategoryProvider';

import '@/style/pages/ItemCategory/ItemCategoryDialog.scss';

/**
 * Item Category form dialog content.
 */
export function ItemCategoryFormDialogContent({
  // #ownProp
  itemCategoryId,
  dialogName,
}) {
  return (
    <ItemCategoryProvider
      itemCategoryId={itemCategoryId}
      dialogName={dialogName}
    >
      <ItemCategoryForm />
    </ItemCategoryProvider>
  );
}
