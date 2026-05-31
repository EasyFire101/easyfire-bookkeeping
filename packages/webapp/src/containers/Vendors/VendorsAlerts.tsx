// @ts-nocheck
import React from 'react';

const VendorDeleteAlert = React.lazy(() => import('@/containers/Alerts/Vendors/VendorDeleteAlert').then(m => ({ default: m.VendorDeleteAlert })));
const VendorActivateAlert = React.lazy(() => import('@/containers/Alerts/Vendors/VendorActivateAlert').then(m => ({ default: m.VendorActivateAlert })));
const VendorInactivateAlert = React.lazy(() => import('@/containers/Alerts/Vendors/VendorInactivateAlert').then(m => ({ default: m.VendorInactivateAlert })));

export const VendorsAlerts = [
  { name: 'vendor-delete', component: VendorDeleteAlert },
  { name: 'vendor-activate', component: VendorActivateAlert },
  { name: 'vendor-inactivate', component: VendorInactivateAlert },
];
