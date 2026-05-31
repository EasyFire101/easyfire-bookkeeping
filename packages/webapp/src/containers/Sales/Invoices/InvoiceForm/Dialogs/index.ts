// @ts-nocheck
import { DialogsName } from '@/constants/dialogs';
import React from 'react';

const InvoiceExchangeRateChangeAlert = React.lazy(() => import('./InvoiceExchangeRateChangeDialog').then(m => ({ default: m.InvoiceExchangeRateChangeDialog })));

const Dialogs = [
  {
    name: DialogsName.InvoiceExchangeRateChangeNotice,
    component: InvoiceExchangeRateChangeAlert,
  },
];

export const index = Dialogs;
