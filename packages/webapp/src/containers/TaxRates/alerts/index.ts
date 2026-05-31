// @ts-nocheck
import React from 'react';

const TaxRateDeleteAlert = React.lazy(() => import('./TaxRateDeleteAlert').then(m => ({ default: m.TaxRateDeleteAlert })));

/**
 * Tax rates alerts.
 */
export const TaxRatesAlerts = [{ name: 'tax-rate-delete', component: TaxRateDeleteAlert }];
