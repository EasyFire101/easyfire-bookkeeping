import React from 'react';
import {
  CommercialDocFooter,
  T,
  If,
  DetailsMenu,
  DetailItem,
} from '@/components';

import { useReceiptDetailDrawerContext } from './ReceiptDetailDrawerProvider';
import intl from 'react-intl-universal';

/**
 * Receipt details footer
 */
export function ReceiptDetailFooter() {
  const { receipt } = useReceiptDetailDrawerContext();

  if (!receipt) {
    return null;
  }

  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={!!receipt.statement}>
          <DetailItem label={intl.get('receipt.details.statement')} multiline>
            {receipt.statement}
          </DetailItem>
        </If>
        <If condition={!!receipt.receiptMessage}>
          <DetailItem
            label={intl.get('receipt.details.receipt_message')}
            multiline
          >
            {receipt.receiptMessage}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
