// @ts-nocheck
import React from 'react';

const ItemCategoryDeleteAlert = React.lazy(() => import('@/containers/Alerts/Items/ItemCategoryDeleteAlert').then(m => ({ default: m.ItemCategoryDeleteAlert })));

export const ItemsCategoriesAlerts = [
  { name: 'item-category-delete', component: ItemCategoryDeleteAlert },
];
