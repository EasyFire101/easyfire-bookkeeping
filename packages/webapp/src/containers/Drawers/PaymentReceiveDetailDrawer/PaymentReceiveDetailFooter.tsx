import React from 'react';
import intl from 'react-intl-universal';
import { CommercialDocFooter, If, DetailsMenu, DetailItem } from '@/components';
import { usePaymentReceiveDetailContext } from './PaymentReceiveDetailProvider';

/**
 * Payment receive detail footer.
 */
export function PaymentReceiveDetailFooter() {
  const { paymentReceive } = usePaymentReceiveDetailContext();

  if (!paymentReceive) {
    return null;
  }
  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={!!paymentReceive.statement}>
          <DetailItem
            label={intl.get('payment_receive.details.statement')}
            multiline
          >
            {paymentReceive.statement}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
