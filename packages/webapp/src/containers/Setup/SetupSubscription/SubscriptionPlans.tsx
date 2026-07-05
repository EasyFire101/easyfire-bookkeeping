// @ts-nocheck
import { Intent } from '@blueprintjs/core';
import * as R from 'ramda';
import { useSubscriptionPlans } from './hooks';
import { AppToaster, Group, GroupProps } from '@/components';
import { SubscriptionPlan } from '@/containers/Subscriptions/component/SubscriptionPlan';
import { withSubscriptionPlanMapper } from '@/containers/Subscriptions/component/withSubscriptionPlanMapper';
import { withPlans } from '@/containers/Subscriptions/withPlans';
import { useGetLemonSqueezyCheckout } from '@/hooks/query';
import { SubscriptionPlansPeriod } from '@/store/plans/plans.reducer';


interface SubscriptionPlansProps {
  wrapProps?: GroupProps;
  onSubscribe?: (variantId: number) => void;
}

export function SubscriptionPlans({
  wrapProps,
  onSubscribe,
}: SubscriptionPlansProps) {
  const subscriptionPlans = useSubscriptionPlans();

  return (
    <Group spacing={10} noWrap align="stretch" {...wrapProps}>
      {subscriptionPlans.map((plan, index) => (
        <SubscriptionPlanMapped key={index} plan={plan} />
      ))}
    </Group>
  );
}

const SubscriptionPlanMapped = R.compose(
  withSubscriptionPlanMapper,
  withPlans(({ plansPeriod }) => ({ plansPeriod })),
)(({ plansPeriod, monthlyVariantId, annuallyVariantId, ...props }) => {
  const { mutateAsync: getLemonCheckout, isLoading } =
    useGetLemonSqueezyCheckout();

  const handleSubscribeBtnClick = () => {
    const variantId =
      SubscriptionPlansPeriod.Monthly === plansPeriod
        ? monthlyVariantId
        : annuallyVariantId;

    getLemonCheckout({ variantId })
      .then((res) => {
        const checkoutUrl = res.data.data.attributes.url;
        window.LemonSqueezy.Url.Open(checkoutUrl);
      })
      .catch(() => {
        AppToaster.show({
          message: 'Something went wrong!',
          intent: Intent.DANGER,
        });
      });
  };
  return (
    <SubscriptionPlan
      {...props}
      onSubscribe={handleSubscribeBtnClick}
      subscribeButtonProps={{
        loading: isLoading,
      }}
    />
  );
});
