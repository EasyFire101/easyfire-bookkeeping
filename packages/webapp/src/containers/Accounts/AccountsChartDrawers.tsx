import { index as AccountDrawer } from '@/containers/Drawers/AccountDrawer';
import { DRAWERS } from '@/constants/drawers';

export function AccountsChartDrawers() {
  return (
    <>
      <AccountDrawer name={DRAWERS.ACCOUNT_DETAILS} />
    </>
  );
}
