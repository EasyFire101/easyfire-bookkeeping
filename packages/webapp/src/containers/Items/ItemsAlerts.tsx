// @ts-nocheck
import React from 'react';

const ItemDeleteAlert = React.lazy(() => import('@/containers/Alerts/Items/ItemDeleteAlert').then(m => ({ default: m.ItemDeleteAlert })));

const ItemInactivateAlert = React.lazy(() => import('@/containers/Alerts/Items/ItemInactivateAlert').then(m => ({ default: m.ItemInactivateAlert })));

const ItemActivateAlert = React.lazy(() => import('@/containers/Alerts/Items/ItemActivateAlert').then(m => ({ default: m.ItemActivateAlert })));

const cancelUnlockingPartialAlert = React.lazy(() => import('@/containers/Alerts/TransactionLocking/cancelUnlockingPartialAlert').then(m => ({ default: m.cancelUnlockingPartialAlert })));

/**
 * Items alert.
 */
export const ItemsAlerts = [
  {
    name: 'item-delete',
    component: ItemDeleteAlert,
  },
  {
    name: 'item-inactivate',
    component: ItemInactivateAlert,
  },
  {
    name: 'item-activate',
    component: ItemActivateAlert,
  },
];
