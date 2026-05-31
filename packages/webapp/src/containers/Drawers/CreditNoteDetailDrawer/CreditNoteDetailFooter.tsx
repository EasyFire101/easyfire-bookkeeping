// @ts-nocheck
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
 * @returns {React.JSX}
 */
export function CreditNoteDetailFooter() {
  const { creditNote } = useCreditNoteDetailDrawerContext();

  return (
    <CommercialDocFooter>
      <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
        <If condition={creditNote.terms_conditions}>
          <DetailItem
            label={intl.get('note')}
            children={creditNote.note}
            multiline
          />
        </If>

        <If condition={creditNote.terms_conditions}>
          <DetailItem label={intl.get('terms_conditions')} multiline>
            {creditNote.terms_conditions}
          </DetailItem>
        </If>
      </DetailsMenu>
    </CommercialDocFooter>
  );
}
