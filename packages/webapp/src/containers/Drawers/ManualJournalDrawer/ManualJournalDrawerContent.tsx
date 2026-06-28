import React from 'react';

import '@/style/components/Drawers/ManualJournalDrawer.scss';

import { DrawerBody } from '@/components';
import { ManualJournalDrawerProvider } from './ManualJournalDrawerProvider';
import { ManualJournalDrawerDetails } from './ManualJournalDrawerDetails';

interface ManualJournalDrawerContentProps {
  manualJournalId: number | undefined;
}

/**
 * Manual Journal drawer content.
 */
export function ManualJournalDrawerContent({
  // #ownProp
  manualJournalId,
}: ManualJournalDrawerContentProps) {
  return (
    <ManualJournalDrawerProvider manualJournalId={manualJournalId}>
      <DrawerBody>
        <ManualJournalDrawerDetails />
      </DrawerBody>
    </ManualJournalDrawerProvider>
  );
}
