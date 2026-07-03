import React from 'react';

import { CommercialDocFooter, DetailsMenu, If, DetailItem } from '@/components';
import { usePaymentMadeDetailContext } from './PaymentMadeDetailProvider';
import intl from 'react-intl-universal';

/**
 * Payment made - Details panel - Footer.
 */
export function PaymentMadeDetailFooter() {
  const { paymentMade } = usePaymentMadeDetailContext();

  if (!paymentMade) {
    return null;
  }

  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={!!paymentMade.statement}>
          <DetailItem
            label={intl.get('payment_made.details.statement')}
            multiline
          >
            {paymentMade.statement}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
