import { ChangeSubscriptionPlanDrawer } from '@/containers/Subscriptions/drawers/ChangeSubscriptionPlanDrawer/ChangeSubscriptionPlanDrawer';
import { DRAWERS } from '@/constants/drawers';

export function SubscriptionsDrawers() {
  return (
    <>
      <ChangeSubscriptionPlanDrawer name={DRAWERS.CHANGE_SUBSCARIPTION_PLAN} />
    </>
  );
}
