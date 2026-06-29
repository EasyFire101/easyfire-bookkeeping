import { useFormikContext } from 'formik';
import { BaseCurrency, BaseCurrencyRoot } from '@/components';
import { useInvoiceIsForeignCustomer } from './utils';
import type { InvoiceFormValues } from './utils';

/**
 * Invoice form currency tag.
 */
export function InvoiceFormCurrencyTag() {
  const isForeignCustomer = useInvoiceIsForeignCustomer();
  const {
    values: { currencyCode },
  } = useFormikContext<InvoiceFormValues>();

  if (!isForeignCustomer) {
    return null;
  }
  return (
    <BaseCurrencyRoot>
      <BaseCurrency currency={currencyCode} />
    </BaseCurrencyRoot>
  );
}
