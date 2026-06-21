// @ts-nocheck
import React from 'react';
import { useFormikContext } from 'formik';
import { ExchangeRateInputGroup } from '@/components';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import { useVendorNoteIsForeignCustomer } from './utils';

/**
 * vendor credit note exchange rate input field.
 * @returns {JSX.Element}
 */
export function VendorCreditNoteExchangeRateInputField({ ...props }) {
  const baseCurrency = useCurrentOrganizationBaseCurrency();
  const { values } = useFormikContext();

  const isForeignCustomer = useVendorNoteIsForeignCustomer();

  // Can't continue if the customer is not foreign.
  if (!isForeignCustomer) {
    return null;
  }
  return (
    <ExchangeRateInputGroup
      fromCurrency={values.currency_code}
      toCurrency={baseCurrency}
      {...props}
    />
  );
}
