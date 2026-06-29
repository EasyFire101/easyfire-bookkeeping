import React from 'react';
import { useFormikContext } from 'formik';
import { ExchangeRateInputGroup } from '@/components';
import { useCurrentOrganizationBaseCurrency } from '@/hooks/query';
import {
  useVendorNoteIsForeignCustomer,
  type VendorCreditFormValues,
} from './utils';

type VendorCreditNoteExchangeRateInputFieldProps = Omit<
  React.ComponentProps<typeof ExchangeRateInputGroup>,
  'fromCurrency' | 'toCurrency'
>;

/**
 * Vendor credit note exchange rate input field.
 */
export function VendorCreditNoteExchangeRateInputField({
  ...props
}: VendorCreditNoteExchangeRateInputFieldProps) {
  const baseCurrency = useCurrentOrganizationBaseCurrency();
  const { values } = useFormikContext<VendorCreditFormValues>();

  const isForeignCustomer = useVendorNoteIsForeignCustomer();

  // Can't continue if the vendor is not foreign.
  if (!isForeignCustomer) {
    return null;
  }
  return (
    <ExchangeRateInputGroup
      {...props}
      fromCurrency={values.currencyCode}
      toCurrency={baseCurrency ?? ''}
    />
  );
}
