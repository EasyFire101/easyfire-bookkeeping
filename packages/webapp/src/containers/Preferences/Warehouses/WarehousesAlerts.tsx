// @ts-nocheck
import React from 'react';

const WarehouseDeleteAlert = React.lazy(() => import('@/containers/Alerts/Warehouses/WarehouseDeleteAlert').then(m => ({ default: m.WarehouseDeleteAlert })));

/**
 * Warehouses alerts.
 */
export const WarehousesAlerts = [{ name: 'warehouse-delete', component: WarehouseDeleteAlert }];
