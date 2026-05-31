// @ts-nocheck
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
 * @returns {React.JSX}
 */
export function ReceiptDetailFooter() {
  const { receipt } = useReceiptDetailDrawerContext();

  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={receipt.statement}>
          <DetailItem label={intl.get('receipt.details.statement')} multiline>
            {receipt.statement}
          </DetailItem>
        </If>
        <If condition={receipt.receipt_message}>
          <DetailItem
            label={intl.get('receipt.details.receipt_message')}
            multiline
          >
            {receipt.receipt_message}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
