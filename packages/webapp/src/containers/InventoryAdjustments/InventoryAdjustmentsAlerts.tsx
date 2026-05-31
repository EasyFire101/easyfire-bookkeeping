// @ts-nocheck
import React from 'react';

const InventoryAdjustmentDeleteAlert = React.lazy(() => import('@/containers/Alerts/Items/InventoryAdjustmentDeleteAlert').then(m => ({ default: m.InventoryAdjustmentDeleteAlert })));

const InventoryAdjustmentPublishAlert = React.lazy(() => import('@/containers/Alerts/Items/InventoryAdjustmentPublishAlert').then(m => ({ default: m.InventoryAdjustmentPublishAlert })));

export const InventoryAdjustmentsAlerts = [
  {
    name: 'inventory-adjustment-delete',
    component: InventoryAdjustmentDeleteAlert,
  },
  {
    name: 'inventory-adjustment-publish',
    component: InventoryAdjustmentPublishAlert,
  },
];
