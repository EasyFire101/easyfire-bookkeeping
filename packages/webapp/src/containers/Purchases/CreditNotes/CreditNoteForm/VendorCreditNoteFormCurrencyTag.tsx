import React from 'react';
import { BaseCurrency, BaseCurrencyRoot } from '@/components';
import { useFormikContext } from 'formik';
import { useVendorCreditNoteFormContext } from './VendorCreditNoteFormProvider';
import {
  useVendorNoteIsForeignCustomer,
  type VendorCreditFormValues,
} from './utils';

/**
 * Vendor credit note currency tag.
 */
export function VendorCreditNoteFormCurrencyTag() {
  const { vendors } = useVendorCreditNoteFormContext();
  const { values } = useFormikContext<VendorCreditFormValues>();
  const isForeignVendor = useVendorNoteIsForeignCustomer();

  const selectVendor = vendors.find((v) => v.id === values.vendorId);

  if (!isForeignVendor) {
    return null;
  }

  return (
    <BaseCurrencyRoot>
      <BaseCurrency currency={selectVendor?.currencyCode} />
    </BaseCurrencyRoot>
  );
}
