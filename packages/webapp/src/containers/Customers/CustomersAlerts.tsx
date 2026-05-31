// @ts-nocheck
import React from 'react';

const CustomerDeleteAlert = React.lazy(() => import('@/containers/Alerts/Customers/CustomerDeleteAlert').then(m => ({ default: m.CustomerDeleteAlert })));
const CustomerActivateAlert = React.lazy(() => import('@/containers/Alerts/Customers/CustomerActivateAlert').then(m => ({ default: m.CustomerActivateAlert })));
const CustomerInactivateAlert = React.lazy(() => import('@/containers/Alerts/Customers/CustomerInactivateAlert').then(m => ({ default: m.CustomerInactivateAlert })));

/**
 * Customers alert.
 */
export const CustomersAlerts = [
  { name: 'customer-delete', component: CustomerDeleteAlert },
  { name: 'customer-activate', component: CustomerActivateAlert },
  { name: 'customer-inactivate', component: CustomerInactivateAlert },
];
