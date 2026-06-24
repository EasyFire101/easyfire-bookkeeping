import React from 'react';

import { CommercialDocFooter, If, DetailsMenu, DetailItem } from '@/components';
import { useEstimateDetailDrawerContext } from './EstimateDetailDrawerProvider';
import intl from 'react-intl-universal';

/**
 * Estimate details footer.
 */
export function EstimateDetailFooter() {
  const { estimate } = useEstimateDetailDrawerContext();

  if (!estimate) {
    return null;
  }

  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={!!estimate.termsConditions}>
          <DetailItem
            label={intl.get('estimate.details.terms_conditions')}
            multiline
          >
            {estimate.termsConditions}
          </DetailItem>
        </If>
        <If condition={!!estimate.note}>
          <DetailItem label={intl.get('estimate.details.note')} multiline>
            {estimate.note}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
