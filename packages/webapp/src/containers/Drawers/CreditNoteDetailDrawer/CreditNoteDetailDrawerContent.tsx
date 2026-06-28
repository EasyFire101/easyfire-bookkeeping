import React from 'react';
import { DrawerBody } from '@/components';
import { CreditNoteDetail } from './CreditNoteDetail';
import { CreditNoteDetailDrawerProvider } from './CreditNoteDetailDrawerProvider';

interface CreditNoteDetailDrawerContentProps {
  creditNoteId: number | undefined;
}

/**
 * Credit note detail drawer content.
 */
export function CreditNoteDetailDrawerContent({
  creditNoteId,
}: CreditNoteDetailDrawerContentProps) {
  return (
    <CreditNoteDetailDrawerProvider creditNoteId={creditNoteId}>
      <DrawerBody>
        <CreditNoteDetail />
      </DrawerBody>
    </CreditNoteDetailDrawerProvider>
  );
}
