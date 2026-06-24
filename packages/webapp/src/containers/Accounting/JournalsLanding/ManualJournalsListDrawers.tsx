import { index as ManualJournalDrawer } from '@/containers/Drawers/ManualJournalDrawer';
import { DRAWERS } from '@/constants/drawers';

export function ManualJournalsListDrawers() {
  return (
    <>
      <ManualJournalDrawer name={DRAWERS.JOURNAL_DETAILS} />
    </>
  );
}
