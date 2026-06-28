import React from 'react';
import {
  CommercialDocFooter,
  T,
  If,
  DetailsMenu,
  DetailItem,
} from '@/components';
import { useCreditNoteDetailDrawerContext } from './CreditNoteDetailDrawerProvider';
import intl from 'react-intl-universal';

/**
 * Credit note detail footer
 */
export function CreditNoteDetailFooter() {
  const { creditNote } = useCreditNoteDetailDrawerContext();

  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={!!creditNote?.termsConditions}>
          <DetailItem
            label={intl.get('note')}
            children={creditNote?.note}
            multiline
          />
        </If>

        <If condition={!!creditNote?.termsConditions}>
          <DetailItem label={intl.get('terms_conditions')} multiline>
            {creditNote?.termsConditions}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
