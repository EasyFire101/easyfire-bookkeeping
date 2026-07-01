import React from 'react';
import { Alignment, Navbar, NavbarGroup } from '@blueprintjs/core';

import { DashboardViewsTabs } from '@/components';

import { withVendorsCreditNotes } from './withVendorsCreditNotes';
import type { WithVendorsCreditNotesProps } from './withVendorsCreditNotes';
import { withVendorsCreditNotesActions } from './withVendorsCreditNotesActions';

import { compose, transfromViewsToTabs } from '@/utils';
import { useVendorsCreditNoteListContext } from './VendorsCreditNoteListProvider';

interface WithVendorsCreditNotesActionsProps {
  setVendorsCreditNoteTableState: (state: Record<string, any>) => void;
}

interface VendorsCreditNoteViewTabsProps {
  vendorCreditCurrentView: string;
  setVendorsCreditNoteTableState: WithVendorsCreditNotesActionsProps['setVendorsCreditNoteTableState'];
}

function VendorsCreditNoteViewTabsInner({
  vendorCreditCurrentView,
  setVendorsCreditNoteTableState,
}: VendorsCreditNoteViewTabsProps) {
  const { VendorCreditsViews } = useVendorsCreditNoteListContext();

  const handleTabsChange = (viewSlug: string | null) => {
    setVendorsCreditNoteTableState({ viewSlug: viewSlug || null });
  };

  const tabs = transfromViewsToTabs(VendorCreditsViews);
  return (
    <Navbar className={'navbar--dashboard-views'}>
      <NavbarGroup align={Alignment.LEFT}>
        <DashboardViewsTabs
          currentViewSlug={vendorCreditCurrentView}
          resourceName={'vendor_credits'}
          tabs={tabs}
          onChange={handleTabsChange}
        />
      </NavbarGroup>
    </Navbar>
  );
}

export const VendorsCreditNoteViewTabs = compose(
  withVendorsCreditNotesActions,
  withVendorsCreditNotes(({ vendorsCreditNoteTableState }: WithVendorsCreditNotesProps) => ({
    vendorCreditCurrentView: vendorsCreditNoteTableState.viewSlug,
  })),
)(VendorsCreditNoteViewTabsInner);
