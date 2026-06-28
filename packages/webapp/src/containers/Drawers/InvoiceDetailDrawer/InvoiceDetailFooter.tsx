import React from 'react';
import {
  CommercialDocFooter,
  T,
  If,
  DetailsMenu,
  DetailItem,
} from '@/components';
import { useInvoiceDetailDrawerContext } from './InvoiceDetailDrawerProvider';
import intl from 'react-intl-universal';

/**
 * Invoice details footer.
 * @returns {React.JSX}
 */
export function InvoiceDetailFooter() {
  const { invoice } = useInvoiceDetailDrawerContext();

  if (!invoice) {
    return null;
  }

  if (!invoice.termsConditions && !invoice.invoiceMessage) {
    return null;
  }
  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={!!invoice.termsConditions}>
          <DetailItem label={intl.get('terms_conditions')} multiline>
            {invoice.termsConditions}
          </DetailItem>
        </If>

        <If condition={!!invoice.invoiceMessage}>
          <DetailItem
            label={intl.get('invoice.details.invoice_message')}
            multiline
          >
            {invoice.invoiceMessage}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
