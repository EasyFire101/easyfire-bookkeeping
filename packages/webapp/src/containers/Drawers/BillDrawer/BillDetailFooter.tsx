import React from 'react';
import {
  CommercialDocFooter,
  T,
  If,
  DetailsMenu,
  DetailItem,
} from '@/components';

import { useBillDrawerContext } from './BillDrawerProvider';
import intl from 'react-intl-universal';

/**
 * Bill detail footer.
 * @returns {React.JSX}
 */
export function BillDetailFooter() {
  const { bill } = useBillDrawerContext();
  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={!!bill?.note}>
          <DetailItem label={intl.get('note')} multiline>
            {bill?.note}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
